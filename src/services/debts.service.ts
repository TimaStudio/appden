import { FirebaseError } from 'firebase/app'
import { addDoc, collection, deleteDoc, doc, updateDoc, where, writeBatch } from 'firebase/firestore'
import { auth, db, getStorageUrl, STORAGE_BUCKETS, storage } from '@lib/firebase/client'
import { displayNameOf, fetchProfilesMap, getById, nowIso, queryDocs, sendNotifications } from '@lib/firebase/db'
import { generateStoragePath } from '@lib/utils'
import { amountToCents, centsToAmount } from '@features/debts/split'
import type { Debt, DebtCurrency, DebtPayment } from '@/types'

export type DebtErrorKind = 'permission' | 'migration' | 'invalid' | 'network' | 'unknown'

/** Error with a message that can be shown to the user as-is (Spanish). */
export class DebtError extends Error {
    kind: DebtErrorKind

    constructor(kind: DebtErrorKind, message: string) {
        super(message)
        this.name = 'DebtError'
        this.kind = kind
    }
}

export interface CreateDebtInput {
    creditorId: string
    debtorId: string
    /** Amount in currency units with up to 2 decimals (12.5 = 12,50 €). */
    amount: number
    currency: DebtCurrency
    concept: string
    dueDate?: string | null
}

export interface UpdateDebtInput {
    amount: number
    currency: DebtCurrency
    concept: string
    dueDate?: string | null
}

export interface DebtBalance {
    owed: number
    lent: number
}

/**
 * Per-user balance. `owed`/`lent` are in `currency` (the group's main currency) and never mix currencies;
 * `byCurrency` has every currency with open debts.
 */
export interface DebtUserBalance extends DebtBalance {
    currency: DebtCurrency
    byCurrency: Partial<Record<DebtCurrency, DebtBalance>>
}

export interface CreateDebtsResult {
    created: Debt[]
    failed: Array<{ input: CreateDebtInput; message: string }>
}

export interface RegisterPaymentResult {
    payment: DebtPayment | null
    receiptFailed: boolean
    settled: boolean
}

/** Turns any Firestore/network error into a DebtError with a clear Spanish message. */
export function toDebtError(error: unknown, fallback = 'No se pudo guardar. Inténtalo de nuevo.'): DebtError {
    if (error instanceof DebtError) return error
    const code = error instanceof FirebaseError ? error.code : ''
    if (code === 'permission-denied') {
        return new DebtError('permission', 'No tienes permiso para hacer esto con esta deuda.')
    }
    if (code === 'unavailable' || code === 'deadline-exceeded') {
        return new DebtError('network', 'Sin conexión. Revisa tu internet e inténtalo de nuevo.')
    }
    const message = error instanceof Error ? error.message : ''
    return new DebtError('unknown', message || fallback)
}

type DebtDoc = Omit<Debt, 'creditor' | 'debtor' | 'payments'>

function toDoc(groupId: string, input: CreateDebtInput, createdBy: string): Omit<DebtDoc, 'id'> {
    const now = nowIso()
    return {
        group_id: groupId,
        creditor_id: input.creditorId,
        debtor_id: input.debtorId,
        amount: centsToAmount(amountToCents(input.amount)),
        currency: input.currency,
        concept: input.concept.trim().slice(0, 200),
        status: 'pending',
        amount_paid: 0,
        created_by: createdBy,
        due_date: input.dueDate || null,
        created_at: now,
        updated_at: now,
    }
}

function validateInput(input: CreateDebtInput): void {
    if (!input.creditorId || !input.debtorId) throw new DebtError('invalid', 'Elige quién presta y quién debe.')
    if (input.creditorId === input.debtorId) throw new DebtError('invalid', 'Una persona no puede deberse dinero a sí misma.')
    if (!(input.amount > 0)) throw new DebtError('invalid', 'El importe debe ser mayor que cero.')
    if (!input.concept.trim()) throw new DebtError('invalid', 'Escribe un concepto.')
}

function currentUserId(): string {
    const uid = auth.currentUser?.uid
    if (!uid) throw new DebtError('permission', 'Necesitas iniciar sesión.')
    return uid
}

async function withPeople(debts: DebtDoc[]): Promise<Debt[]> {
    const profiles = await fetchProfilesMap(debts.flatMap((debt) => [debt.creditor_id, debt.debtor_id]))
    return normalizeDebts(debts.map((debt) => ({ ...debt, creditor: profiles.get(debt.creditor_id), debtor: profiles.get(debt.debtor_id) })))
}

function formatAmount(debt: Pick<Debt, 'amount' | 'currency'>): string {
    return `${Number(debt.amount).toFixed(2)} ${debt.currency}`
}

/** Same messages the old database trigger sent. */
async function notifyDebtCreated(actorId: string, debt: Debt): Promise<void> {
    const profiles = await fetchProfilesMap([actorId, debt.creditor_id, debt.debtor_id])
    const actor = displayNameOf(profiles.get(actorId))
    const creditor = displayNameOf(profiles.get(debt.creditor_id))
    const debtor = displayNameOf(profiles.get(debt.debtor_id))
    const amount = formatAmount(debt)
    const base = { group_id: debt.group_id, resource_type: 'debt' as const, resource_id: debt.id, type: 'debt_created' as const }
    await sendNotifications(actorId, [
        {
            ...base,
            user_id: debt.debtor_id,
            title: 'Nueva deuda',
            body:
                actorId === debt.creditor_id
                    ? `${creditor} te ha apuntado ${amount} por "${debt.concept}"`
                    : `${actor} ha apuntado que le debes ${amount} a ${creditor} por "${debt.concept}"`,
        },
        {
            ...base,
            user_id: debt.creditor_id,
            title: 'Nueva deuda a tu favor',
            body:
                actorId === debt.debtor_id
                    ? `${debtor} ha apuntado que te debe ${amount} por "${debt.concept}"`
                    : `${actor} ha apuntado que ${debtor} te debe ${amount} por "${debt.concept}"`,
        },
    ])
}

async function notifyDebtPaid(actorId: string, debt: Pick<Debt, 'id' | 'group_id' | 'creditor_id' | 'debtor_id' | 'concept'>): Promise<void> {
    const profiles = await fetchProfilesMap([actorId, debt.debtor_id])
    const base = { group_id: debt.group_id, resource_type: 'debt' as const, resource_id: debt.id, type: 'debt_paid' as const, title: 'Deuda saldada' }
    await sendNotifications(actorId, [
        { ...base, user_id: debt.creditor_id, body: `${displayNameOf(profiles.get(debt.debtor_id))} ha saldado "${debt.concept}"` },
        { ...base, user_id: debt.debtor_id, body: `${displayNameOf(profiles.get(actorId))} ha marcado como saldada "${debt.concept}"` },
    ])
}

export const debtsService = {
    /** All debts of a group (with creditor/debtor profiles), newest first. */
    async getDebts(groupId: string): Promise<Debt[]> {
        const rows = await queryDocs<DebtDoc>('debts', where('group_id', '==', groupId))
        return withPeople(rows.sort((a, b) => b.created_at.localeCompare(a.created_at)))
    },

    /** One debt with its payment history (oldest payment first). */
    async getDebt(debtId: string): Promise<Debt> {
        const row = await getById<DebtDoc>('debts', debtId)
        if (!row) throw new DebtError('invalid', 'Esta deuda ya no existe.')
        const [debt] = await withPeople([row])

        const payments = (
            await queryDocs<DebtPayment>('debt_payments', where('group_id', '==', row.group_id), where('debt_id', '==', debtId))
        )
            .map((payment) => ({ ...payment, amount: Number(payment.amount) }))
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
        const payers = await fetchProfilesMap(payments.map((payment) => payment.paid_by))

        debt.payments = await Promise.all(
            payments.map(async (payment) => {
                const withPayer = { ...payment, payer: payers.get(payment.paid_by) }
                if (!payment.receipt_url || /^https?:\/\//.test(payment.receipt_url)) return withPayer
                const signed = await getStorageUrl(STORAGE_BUCKETS.FILES, payment.receipt_url).catch(() => null)
                return { ...withPayer, receipt_url: signed ?? payment.receipt_url }
            })
        )
        return debt
    },

    async getCapabilities(): Promise<{ groupDebts: boolean }> {
        return { groupDebts: true }
    },

    /** Any member can write down a debt between two members of the group. */
    async createDebt(groupId: string, input: CreateDebtInput): Promise<Debt> {
        validateInput(input)
        const actorId = currentUserId()
        let debt: Debt
        try {
            const data = toDoc(groupId, input, actorId)
            const ref = await addDoc(collection(db, 'debts'), data)
            ;[debt] = await withPeople([{ id: ref.id, ...data }])
        } catch (error) {
            throw toDebtError(error, 'No se pudo apuntar la deuda.')
        }
        await notifyDebtCreated(actorId, debt)
        return debt
    },

    /** Several debts at once (bill splitter), in one atomic batch. */
    async createDebts(groupId: string, inputs: CreateDebtInput[]): Promise<CreateDebtsResult> {
        if (inputs.length === 0) return { created: [], failed: [] }
        inputs.forEach(validateInput)
        const actorId = currentUserId()

        const rows = inputs.map((input) => ({ id: doc(collection(db, 'debts')).id, ...toDoc(groupId, input, actorId) }))
        try {
            const batch = writeBatch(db)
            for (const { id, ...data } of rows) batch.set(doc(db, 'debts', id), data)
            await batch.commit()
        } catch (error) {
            const message = toDebtError(error).message
            return { created: [], failed: inputs.map((input) => ({ input, message })) }
        }

        const created = await withPeople(rows)
        await Promise.all(created.map((debt) => notifyDebtCreated(actorId, debt)))
        return { created, failed: [] }
    },

    /** Edit concept, amount, currency or due date. The amount can't go below what has been paid. */
    async updateDebt(debt: Debt, input: UpdateDebtInput): Promise<void> {
        const amountCents = amountToCents(input.amount)
        const paidCents = amountToCents(debt.amount_paid)
        if (amountCents <= 0) throw new DebtError('invalid', 'El importe debe ser mayor que cero.')
        if (amountCents < paidCents) throw new DebtError('invalid', 'El importe no puede ser menor que lo que ya se ha pagado.')
        if (!input.concept.trim()) throw new DebtError('invalid', 'Escribe un concepto.')

        const patch: Record<string, unknown> = {
            amount: centsToAmount(amountCents),
            currency: input.currency,
            concept: input.concept.trim().slice(0, 200),
            status: paidCents >= amountCents ? 'paid' : paidCents > 0 ? 'partial' : 'pending',
            updated_at: nowIso(),
        }
        if (input.dueDate !== undefined) patch.due_date = input.dueDate || null

        try {
            await updateDoc(doc(db, 'debts', debt.id), patch)
        } catch (error) {
            throw toDebtError(error)
        }
    },

    async deleteDebt(debtId: string): Promise<void> {
        try {
            await deleteDoc(doc(db, 'debts', debtId))
        } catch (error) {
            const debtError = toDebtError(error, 'No se pudo eliminar la deuda.')
            if (debtError.kind === 'permission') {
                throw new DebtError('permission', 'Solo quien prestó el dinero o quien apuntó la deuda puede eliminarla.')
            }
            throw debtError
        }
    },

    /** Register a partial or full payment. Either party (or whoever wrote the debt down) can do it. */
    async registerPayment(
        debt: Debt,
        recordedBy: string,
        input: { amount: number; note?: string | null; receiptFile?: File | null }
    ): Promise<RegisterPaymentResult> {
        const totalCents = amountToCents(debt.amount)
        const paidCents = amountToCents(debt.amount_paid)
        const payCents = Math.min(amountToCents(input.amount), totalCents - paidCents)
        if (payCents <= 0) throw new DebtError('invalid', 'El importe del pago debe ser mayor que cero.')

        const newPaidCents = paidCents + payCents
        const newStatus = newPaidCents >= totalCents ? 'paid' : 'partial'

        let receiptPath: string | null = null
        let receiptMimeType: string | null = null
        let receiptFailed = false
        if (input.receiptFile) {
            const path = generateStoragePath(`${debt.group_id}/debt-receipts`, recordedBy, input.receiptFile.name)
            const { error: uploadError } = await storage
                .from(STORAGE_BUCKETS.FILES)
                .upload(path, input.receiptFile, { upsert: false, cacheControl: '3600', contentType: input.receiptFile.type || undefined })
            if (uploadError) {
                receiptFailed = true
            } else {
                receiptPath = path
                receiptMimeType = input.receiptFile.type || null
            }
        }

        const paymentRef = doc(collection(db, 'debt_payments'))
        const payment: DebtPayment = {
            id: paymentRef.id,
            debt_id: debt.id,
            amount: centsToAmount(payCents),
            note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
            // paid_by is who paid (the debtor), even when the creditor writes it down.
            paid_by: debt.debtor_id,
            recorded_by: recordedBy,
            receipt_url: receiptPath,
            receipt_mime_type: receiptMimeType,
            created_at: nowIso(),
        }

        try {
            const { id: _id, ...paymentData } = payment
            const batch = writeBatch(db)
            batch.set(paymentRef, { ...paymentData, group_id: debt.group_id })
            batch.update(doc(db, 'debts', debt.id), { amount_paid: centsToAmount(newPaidCents), status: newStatus, updated_at: nowIso() })
            await batch.commit()
        } catch (error) {
            throw toDebtError(error, 'No se pudo registrar el pago.')
        }

        if (newStatus === 'paid' && debt.status !== 'paid') await notifyDebtPaid(recordedBy, debt)
        return { payment, receiptFailed, settled: newStatus === 'paid' }
    },

    /** Mark a debt as fully paid: registers the pending amount as a final payment so the history adds up. */
    async markAsPaid(debt: Debt, recordedBy: string): Promise<RegisterPaymentResult> {
        const remaining = centsToAmount(amountToCents(debt.amount) - amountToCents(debt.amount_paid))
        if (remaining <= 0) {
            try {
                await updateDoc(doc(db, 'debts', debt.id), { status: 'paid', updated_at: nowIso() })
            } catch (error) {
                throw toDebtError(error)
            }
            if (debt.status !== 'paid') await notifyDebtPaid(recordedBy, debt)
            return { payment: null, receiptFailed: false, settled: true }
        }
        return this.registerPayment(debt, recordedBy, { amount: remaining, note: 'Saldada' })
    },

    /** Per-user open balances for a group, without mixing currencies. */
    async getGroupSummary(groupId: string): Promise<Record<string, DebtUserBalance>> {
        const rows = await queryDocs<DebtDoc>('debts', where('group_id', '==', groupId))
        return summarizeBalances(normalizeDebts(rows as Debt[]))
    },
}

function normalizeDebts(debts: Debt[]): Debt[] {
    return debts.map((debt) => ({
        ...debt,
        amount: Number(debt.amount),
        amount_paid: Number(debt.amount_paid),
    }))
}

/** Main currency of a set of debts: EUR if present, otherwise the most used one. */
export function mainCurrency(debts: Array<Pick<Debt, 'currency'>>): DebtCurrency {
    if (debts.length === 0 || debts.some((debt) => debt.currency === 'EUR')) return 'EUR'
    const counts = new Map<DebtCurrency, number>()
    for (const debt of debts) counts.set(debt.currency, (counts.get(debt.currency) ?? 0) + 1)
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0]
}

export function summarizeBalances(
    debts: Array<Pick<Debt, 'creditor_id' | 'debtor_id' | 'amount' | 'amount_paid' | 'status' | 'currency'>>
): Record<string, DebtUserBalance> {
    const open = debts.filter((debt) => debt.status !== 'paid')
    const currency = mainCurrency(open)
    const cents: Record<string, Partial<Record<DebtCurrency, { owed: number; lent: number }>>> = {}
    const bucket = (userId: string, code: DebtCurrency) => {
        const perUser = cents[userId] ?? (cents[userId] = {})
        return perUser[code] ?? (perUser[code] = { owed: 0, lent: 0 })
    }

    for (const debt of open) {
        const remaining = amountToCents(Number(debt.amount)) - amountToCents(Number(debt.amount_paid))
        if (remaining <= 0) continue
        bucket(debt.creditor_id, debt.currency).lent += remaining
        bucket(debt.debtor_id, debt.currency).owed += remaining
    }

    const summary: Record<string, DebtUserBalance> = {}
    for (const [userId, perCurrency] of Object.entries(cents)) {
        const byCurrency: Partial<Record<DebtCurrency, DebtBalance>> = {}
        for (const [code, value] of Object.entries(perCurrency) as Array<[DebtCurrency, { owed: number; lent: number }]>) {
            byCurrency[code] = { owed: centsToAmount(value.owed), lent: centsToAmount(value.lent) }
        }
        const main = byCurrency[currency] ?? { owed: 0, lent: 0 }
        summary[userId] = { owed: main.owed, lent: main.lent, currency, byCurrency }
    }
    return summary
}
