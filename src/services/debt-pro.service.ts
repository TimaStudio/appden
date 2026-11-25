import { addDoc, collection, doc, getDoc, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db } from '@lib/firebase/client'
import { getById, nowIso, queryDocs } from '@lib/firebase/db'
import { buildWhatsAppUrl, formatMoney } from '@lib/utils'
import { amountToCents, centsToAmount, settleOpenDebts } from '@features/debts/split'
import type {
    Debt,
    DebtCurrency,
    DebtInstallment,
    DebtPayment,
    DebtReminder,
    DebtReminderFrequency,
    GroupFinancialHealth,
    GroupGoal,
    GroupGoalStatus,
    GroupGoalType,
    GroupMemberPermission,
    GroupSettlementTransfer,
    MonthlyDebtSummary,
    UserBadge,
} from '@/types'

type ReminderChannels = {
    push: boolean
    email: boolean
    whatsapp: boolean
}

type ReminderConfigInput = {
    debtId: string
    groupId: string
    debtorId: string
    createdBy: string
    frequency: DebtReminderFrequency
    channels: ReminderChannels
    active: boolean
}

type CreatePlanInput = {
    debtId: string
    totalAmount: number
    amountPaid: number
    installments: number
    firstDueDate: string
}

type GoalInput = {
    groupId: string
    createdBy: string
    title: string
    targetType: GroupGoalType
    targetValue: number
    deadline?: string | null
}

type PermissionInput = {
    groupId: string
    userId: string
    updatedBy: string
    canManageDebts: boolean
    canManageMusic: boolean
    canManageFiles: boolean
    canManageMembers: boolean
}

type InstallmentDoc = DebtInstallment & { group_id: string }

const groupDebts = (groupId: string) => queryDocs<Debt>('debts', where('group_id', '==', groupId))

export const debtProService = {
    /** Friendly reminder text for WhatsApp ("Hola Marcos, ..."). */
    buildReminderText(debt: Pick<Debt, 'concept' | 'amount' | 'amount_paid' | 'currency'>, debtorName: string): string {
        const remaining = centsToAmount(Math.max(0, amountToCents(debt.amount) - amountToCents(debt.amount_paid)))
        const firstName = debtorName.trim().split(/\s+/)[0] || debtorName
        return `¡Hola, ${firstName}! Te recuerdo que tienes pendientes ${formatMoney(remaining, debt.currency)} de «${debt.concept}». Cuando puedas, me lo pasas. ¡Gracias! 🙌`
    },

    async getReminderConfig(debtId: string): Promise<DebtReminder | null> {
        return getById<DebtReminder>('debt_reminders', debtId).catch(() => null)
    },

    async upsertReminderConfig(input: ReminderConfigInput): Promise<DebtReminder> {
        const ref = doc(db, 'debt_reminders', input.debtId)
        const existing = (await getDoc(ref).catch(() => null))?.data()
        const now = nowIso()
        const data = {
            debt_id: input.debtId,
            group_id: input.groupId,
            debtor_id: input.debtorId,
            created_by: input.createdBy,
            frequency: input.frequency,
            channels: input.channels,
            active: input.active,
            next_run_at: nextReminderDate(input.frequency),
            last_sent_at: (existing?.last_sent_at as string | null | undefined) ?? null,
            created_at: (existing?.created_at as string | undefined) ?? now,
            updated_at: now,
        }
        await setDoc(ref, data)
        return { id: input.debtId, ...data }
    },

    async sendReminderNow(
        debt: Pick<Debt, 'id' | 'concept' | 'amount' | 'amount_paid' | 'currency'>,
        debtorName: string,
        reminder: DebtReminder
    ): Promise<{ whatsappUrl: string | null }> {
        const text = this.buildReminderText(debt, debtorName)

        if (reminder.channels.push && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('The Appden - Recordatorio de deuda', { body: text })
        }

        const whatsappUrl = reminder.channels.whatsapp ? buildWhatsAppUrl(text) : null
        const now = nowIso()
        await updateDoc(doc(db, 'debt_reminders', debt.id), {
            last_sent_at: now,
            next_run_at: nextReminderDate(reminder.frequency),
            updated_at: now,
        })
        return { whatsappUrl }
    },

    async requestPushPermission(): Promise<NotificationPermission | 'unsupported'> {
        if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
        if (Notification.permission === 'granted') return 'granted'
        return Notification.requestPermission()
    },

    async createPaymentPlan(input: CreatePlanInput): Promise<DebtInstallment[]> {
        const safeCount = Math.max(1, Math.floor(input.installments))
        const remaining = Math.max(0, input.totalAmount - input.amountPaid)
        if (remaining <= 0) return []

        const debt = await getById<Debt>('debts', input.debtId)
        if (!debt) throw new Error('Esta deuda ya no existe.')

        const base = roundMoney(remaining / safeCount)
        const now = nowIso()
        const items: DebtInstallment[] = []
        let assigned = 0
        for (let index = 0; index < safeCount; index += 1) {
            const amount = index === safeCount - 1 ? roundMoney(remaining - assigned) : base
            assigned += amount
            items.push({
                id: `${input.debtId}_${index + 1}`,
                debt_id: input.debtId,
                installment_number: index + 1,
                amount,
                due_date: addMonths(input.firstDueDate, index),
                status: 'pending',
                paid_at: null,
                created_at: now,
            })
        }

        // The new plan replaces the previous one entirely.
        const previous = await queryDocs<InstallmentDoc>(
            'debt_installments',
            where('group_id', '==', debt.group_id),
            where('debt_id', '==', input.debtId)
        )
        const batch = writeBatch(db)
        for (const old of previous) if (!items.some((item) => item.id === old.id)) batch.delete(doc(db, 'debt_installments', old.id))
        for (const { id, ...item } of items) batch.set(doc(db, 'debt_installments', id), { ...item, group_id: debt.group_id })
        await batch.commit()
        return items
    },

    async getPaymentPlan(debtId: string, amountPaid: number): Promise<DebtInstallment[]> {
        const debt = await getById<Debt>('debts', debtId)
        if (!debt) return []
        const items = await queryDocs<InstallmentDoc>(
            'debt_installments',
            where('group_id', '==', debt.group_id),
            where('debt_id', '==', debtId)
        )
        return applyInstallmentPayments(
            items.sort((a, b) => a.installment_number - b.installment_number),
            amountPaid
        )
    },

    async getSettlementPlan(groupId: string): Promise<GroupSettlementTransfer[]> {
        const open = (await groupDebts(groupId)).filter((debt) => debt.status !== 'paid')
        // Integer-cent settlement per currency (never mixes € with $).
        return settleOpenDebts(open).flatMap((bucket) =>
            bucket.transfers.map((transfer) => ({
                from_user_id: transfer.fromId,
                to_user_id: transfer.toId,
                amount: centsToAmount(transfer.cents),
                currency: bucket.currency as DebtCurrency,
            }))
        )
    },

    /** Monthly figures for one currency (amounts in other currencies are left out, not added up). */
    async getMonthlySummary(groupId: string, currency: DebtCurrency = 'EUR', month?: string): Promise<MonthlyDebtSummary> {
        const target = month ?? currentMonthKey()
        const [year, monthNum] = target.split('-').map(Number)
        // Local-time month boundaries: a debt written on the 1st at 00:30 in Spain belongs to that month.
        const start = new Date(year, monthNum - 1, 1).toISOString()
        const end = new Date(year, monthNum, 1).toISOString()

        const debts = (await groupDebts(groupId)).filter((item) => item.currency === currency)
        const createdThisMonth = debts.filter((item) => item.created_at >= start && item.created_at < end)
        const totalCreated = createdThisMonth.reduce((sum, item) => sum + Number(item.amount), 0)
        const pendingAmount = debts
            .filter((item) => item.status !== 'paid')
            .reduce((sum, item) => sum + Math.max(0, Number(item.amount) - Number(item.amount_paid)), 0)

        const debtIds = new Set(debts.map((item) => item.id))
        const payments = await queryDocs<DebtPayment>('debt_payments', where('group_id', '==', groupId))
        const totalPaid = payments
            .filter((item) => debtIds.has(item.debt_id) && item.created_at >= start && item.created_at < end)
            .reduce((sum, item) => sum + Number(item.amount), 0)

        const overdueAmount = await this.getOverdueAmount(groupId)

        return {
            month: target,
            total_created: roundMoney(totalCreated),
            total_paid: roundMoney(totalPaid),
            pending_amount: roundMoney(pendingAmount),
            overdue_amount: roundMoney(overdueAmount),
            active_debts: debts.filter((item) => item.status !== 'paid').length,
        }
    },

    async getFinancialHealth(groupId: string): Promise<GroupFinancialHealth> {
        const debts = await groupDebts(groupId)

        const totalAmount = debts.reduce((sum, item) => sum + Number(item.amount), 0)
        const totalPaid = debts.reduce((sum, item) => sum + Number(item.amount_paid), 0)
        const pending = debts.reduce((sum, item) => {
            if (item.status === 'paid') return sum
            return sum + Math.max(0, Number(item.amount) - Number(item.amount_paid))
        }, 0)

        const overdue = await this.getOverdueAmount(groupId)
        const overdueRatio = pending > 0 ? clamp01(overdue / pending) : 0
        const repaymentRatio = totalAmount > 0 ? clamp01(totalPaid / totalAmount) : 1

        const debtByDebtor = new Map<string, number>()
        for (const debt of debts) {
            const remaining = Math.max(0, Number(debt.amount) - Number(debt.amount_paid))
            if (remaining <= 0) continue
            debtByDebtor.set(debt.debtor_id, (debtByDebtor.get(debt.debtor_id) ?? 0) + remaining)
        }

        const maxConcentration = Math.max(0, ...Array.from(debtByDebtor.values()))
        const concentrationRatio = pending > 0 ? clamp01(maxConcentration / pending) : 0
        const score = Math.round(Math.max(0, Math.min(100, 100 - overdueRatio * 40 - (1 - repaymentRatio) * 35 - concentrationRatio * 25)))
        const status = score >= 85 ? 'excellent' : score >= 70 ? 'healthy' : score >= 45 ? 'warning' : 'critical'

        return { score, status, indicators: { overdueRatio, repaymentRatio, concentrationRatio } }
    },

    async listGoals(groupId: string): Promise<GroupGoal[]> {
        const goals = await queryDocs<GroupGoal>('group_goals', where('group_id', '==', groupId))
        return goals.sort((a, b) => b.created_at.localeCompare(a.created_at))
    },

    async createGoal(input: GoalInput): Promise<GroupGoal> {
        const now = nowIso()
        const data = {
            group_id: input.groupId,
            created_by: input.createdBy,
            title: input.title.trim(),
            target_type: input.targetType,
            target_value: input.targetValue,
            current_value: 0,
            deadline: input.deadline ?? null,
            status: 'active' as GroupGoalStatus,
            created_at: now,
            updated_at: now,
        }
        const ref = await addDoc(collection(db, 'group_goals'), data)
        return { id: ref.id, ...data }
    },

    async updateGoalProgress(goalId: string, currentValue: number): Promise<void> {
        const goal = await this.getGoalById(goalId)
        if (!goal) return
        const normalized = Math.max(0, currentValue)
        await updateDoc(doc(db, 'group_goals', goalId), {
            current_value: normalized,
            status: normalized >= goal.target_value ? 'completed' : goal.status,
            updated_at: nowIso(),
        })
    },

    async listBadges(groupId: string, userId?: string): Promise<UserBadge[]> {
        const badges = await queryDocs<UserBadge>(
            'user_badges',
            where('group_id', '==', groupId),
            ...(userId ? [where('user_id', '==', userId)] : [])
        )
        return badges.sort((a, b) => b.awarded_at.localeCompare(a.awarded_at))
    },

    async recomputeBadges(groupId: string): Promise<UserBadge[]> {
        const [debts, group] = await Promise.all([groupDebts(groupId), getById<{ member_ids: string[] }>('groups', groupId)])
        const memberIds = group?.member_ids ?? []

        const outstandingByDebtor = new Map<string, number>()
        const lentByCreditor = new Map<string, number>()
        for (const debt of debts) {
            const remaining = Math.max(0, Number(debt.amount) - Number(debt.amount_paid))
            if (remaining > 0) outstandingByDebtor.set(debt.debtor_id, (outstandingByDebtor.get(debt.debtor_id) ?? 0) + remaining)
            lentByCreditor.set(debt.creditor_id, (lentByCreditor.get(debt.creditor_id) ?? 0) + Number(debt.amount))
        }

        let topContributor: string | null = null
        let topAmount = 0
        for (const [userId, amount] of lentByCreditor.entries()) {
            if (amount > topAmount) {
                topAmount = amount
                topContributor = userId
            }
        }

        const badges: UserBadge[] = []
        for (const userId of memberIds) {
            if ((outstandingByDebtor.get(userId) ?? 0) <= 0.009) badges.push(buildBadge(groupId, userId, 'sin_deuda', 'Sin deuda'))
            if (topContributor && userId === topContributor) badges.push(buildBadge(groupId, userId, 'top_contributor', 'Top contributor'))
            const debtsAsDebtor = debts.filter((item) => item.debtor_id === userId)
            if (debtsAsDebtor.length > 0 && debtsAsDebtor.every((item) => item.status === 'paid')) {
                badges.push(buildBadge(groupId, userId, 'pagador_constante', 'Pagador constante'))
            }
        }

        const previous = await queryDocs<UserBadge>('user_badges', where('group_id', '==', groupId))
        const keep = new Set(badges.map((badge) => badge.id))
        const batch = writeBatch(db)
        for (const old of previous) if (!keep.has(old.id)) batch.delete(doc(db, 'user_badges', old.id))
        for (const { id, ...badge } of badges) {
            const awardedAt = previous.find((old) => old.id === id)?.awarded_at ?? badge.awarded_at
            batch.set(doc(db, 'user_badges', id), { ...badge, awarded_at: awardedAt })
        }
        await batch.commit()
        return badges
    },

    async exportGroupData(groupId: string, format: 'csv' | 'json'): Promise<{ filename: string; mime: string; content: string }> {
        const debts = (await groupDebts(groupId))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map(({ id, creditor_id, debtor_id, amount, amount_paid, currency, concept, status, created_at, updated_at }) => ({
                id,
                creditor_id,
                debtor_id,
                amount,
                amount_paid,
                currency,
                concept,
                status,
                created_at,
                updated_at,
            }))

        if (format === 'json') {
            return {
                filename: `the-appden-debts-${groupId}.json`,
                mime: 'application/json',
                content: JSON.stringify({ exportedAt: nowIso(), debts }, null, 2),
            }
        }

        const header = ['id', 'creditor_id', 'debtor_id', 'amount', 'amount_paid', 'currency', 'concept', 'status', 'created_at', 'updated_at']
        const rows = debts.map((row) => [
            row.id,
            row.creditor_id,
            row.debtor_id,
            Number(row.amount).toFixed(2),
            Number(row.amount_paid).toFixed(2),
            row.currency,
            sanitizeCsv(String(row.concept ?? '')),
            row.status,
            row.created_at,
            row.updated_at,
        ])

        return {
            filename: `the-appden-debts-${groupId}.csv`,
            mime: 'text/csv;charset=utf-8',
            content: [header.join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n'),
        }
    },

    async listGroupPermissions(groupId: string): Promise<GroupMemberPermission[]> {
        return queryDocs<GroupMemberPermission>('group_member_permissions', where('group_id', '==', groupId))
    },

    async upsertGroupPermission(input: PermissionInput): Promise<GroupMemberPermission> {
        const id = `${input.groupId}_${input.userId}`
        const data = {
            group_id: input.groupId,
            user_id: input.userId,
            can_manage_debts: input.canManageDebts,
            can_manage_music: input.canManageMusic,
            can_manage_files: input.canManageFiles,
            can_manage_members: input.canManageMembers,
            updated_by: input.updatedBy,
            updated_at: nowIso(),
        }
        await setDoc(doc(db, 'group_member_permissions', id), data)
        return { id, ...data }
    },

    async getOverdueAmount(groupId: string): Promise<number> {
        const today = new Date().toISOString().slice(0, 10)
        const installments = await queryDocs<InstallmentDoc>('debt_installments', where('group_id', '==', groupId))
        return roundMoney(
            installments.reduce((sum, row) => (row.status === 'paid' || row.due_date >= today ? sum : sum + Number(row.amount)), 0)
        )
    },

    async getGoalById(goalId: string): Promise<GroupGoal | null> {
        return getById<GroupGoal>('group_goals', goalId)
    },
}

function nextReminderDate(frequency: DebtReminderFrequency): string {
    const days = frequency === 'suave' ? 7 : frequency === 'normal' ? 3 : 1
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
}

function addMonths(dateIso: string, months: number): string {
    const base = new Date(dateIso)
    const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()))
    return date.toISOString().slice(0, 10)
}

function applyInstallmentPayments(items: DebtInstallment[], amountPaid: number): DebtInstallment[] {
    let remainingPaid = Math.max(0, amountPaid)
    const today = new Date().toISOString().slice(0, 10)

    return items.map((item) => {
        const amount = Number(item.amount)
        const covered = Math.max(0, Math.min(amount, remainingPaid))
        remainingPaid = Math.max(0, remainingPaid - covered)
        const status = covered >= amount ? 'paid' : item.due_date < today ? 'overdue' : 'pending'
        return { ...item, status, paid_at: covered >= amount ? item.paid_at ?? nowIso() : null }
    })
}

function buildBadge(groupId: string, userId: string, badgeKey: string, badgeLabel: string): UserBadge {
    return {
        id: `${groupId}_${userId}_${badgeKey}`,
        group_id: groupId,
        user_id: userId,
        badge_key: badgeKey,
        badge_label: badgeLabel,
        awarded_at: nowIso(),
        payload: {},
    }
}

function currentMonthKey(): string {
    const now = new Date()
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function sanitizeCsv(value: string): string {
    return value.replace(/\n/g, ' ').replace(/\r/g, ' ').trim()
}

function csvCell(value: string): string {
    if (/[,"\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
    return value
}

function roundMoney(value: number): number {
    return Math.round(value * 100) / 100
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value))
}
