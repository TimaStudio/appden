import { addDoc, collection, doc, getCountFromServer, getDoc, query, updateDoc, where, writeBatch } from 'firebase/firestore'
import { db, STORAGE_BUCKETS, storage } from '@lib/firebase/client'
import { fetchProfilesMap, miniProfile, nowIso, queryDocs } from '@lib/firebase/db'
import { generateStoragePath } from '@lib/utils'
import type { ReportItem, ReportNotification, ReportSeverity, ReportStatus, ReportType } from '@features/reports/types'

type CreateReportInput = {
    userId: string
    groupId?: string | null
    type: ReportType
    title: string
    description: string
    reproductionSteps?: string
    severity?: ReportSeverity | null
    imageFile?: File | null
}

type ListReportsFilters = {
    groupId?: string | null
    status?: ReportStatus | 'all'
    type?: ReportType | 'all'
    search?: string
    limit?: number
}

type ReportDoc = Omit<ReportItem, 'author'>

const cleanText = (value: string | null | undefined, max: number) => (value?.trim() ? value.trim().slice(0, max) : null)

async function withAuthors(reports: ReportDoc[]): Promise<ReportItem[]> {
    const profiles = await fetchProfilesMap(reports.map((report) => report.user_id))
    return reports.map((report) => ({ ...report, author: miniProfile(profiles.get(report.user_id)) as ReportItem['author'] }))
}

async function readReport(reportId: string): Promise<ReportItem> {
    const snap = await getDoc(doc(db, 'reports', reportId))
    if (!snap.exists()) throw new Error('Este reporte ya no existe.')
    const [report] = await withAuthors([{ id: snap.id, ...snap.data() } as ReportDoc])
    return report
}

/** App admins are `admins/{uid}` documents; each new report notifies them. */
async function notifyAdmins(reportId: string): Promise<void> {
    try {
        const admins = await queryDocs<{ id: string }>('admins')
        if (admins.length === 0) return
        const batch = writeBatch(db)
        for (const admin of admins) {
            batch.set(doc(collection(db, 'report_notifications')), {
                report_id: reportId,
                admin_user_id: admin.id,
                read: false,
                read_at: null,
                created_at: nowIso(),
            })
        }
        await batch.commit()
    } catch (error) {
        console.warn('[Reports] No se pudo avisar a los administradores:', error)
    }
}

export const reportsService = {
    async create(input: CreateReportInput): Promise<ReportItem> {
        let imageUrl: string | null = null
        if (input.imageFile) {
            const path = generateStoragePath(input.groupId ?? 'global', input.userId, input.imageFile.name)
            const { error } = await storage
                .from(STORAGE_BUCKETS.REPORTS)
                .upload(path, input.imageFile, { cacheControl: '3600', upsert: false, contentType: input.imageFile.type || undefined })
            if (!error) imageUrl = `${STORAGE_BUCKETS.REPORTS}/${path}`
        }

        const now = nowIso()
        const steps = cleanText(input.reproductionSteps, 3000)
        const data = {
            group_id: input.groupId ?? null,
            user_id: input.userId,
            type: input.type,
            title: input.title.trim().slice(0, 140),
            description: input.description.trim().slice(0, 3000),
            reproduction_steps: steps,
            steps,
            severity: input.severity ?? null,
            image_url: imageUrl,
            status: 'open' as ReportStatus,
            created_at: now,
            updated_at: now,
        }
        const ref = await addDoc(collection(db, 'reports'), data)
        await notifyAdmins(ref.id)
        const [report] = await withAuthors([{ id: ref.id, ...data }])
        return report
    },

    async list(filters: ListReportsFilters = {}): Promise<ReportItem[]> {
        const rows = await queryDocs<ReportDoc>('reports', ...(filters.groupId ? [where('group_id', '==', filters.groupId)] : []))
        const search = filters.search?.trim().toLowerCase() ?? ''
        const filtered = rows
            .filter((row) => !filters.status || filters.status === 'all' || row.status === filters.status)
            .filter((row) => !filters.type || filters.type === 'all' || row.type === filters.type)
            .filter((row) => !search || row.title.toLowerCase().includes(search) || row.description.toLowerCase().includes(search))
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, filters.limit ?? 50)
        return withAuthors(filtered)
    },

    async getById(reportId: string): Promise<ReportItem | null> {
        return readReport(reportId).catch(() => null)
    },

    async updateStatus(reportId: string, status: ReportStatus): Promise<ReportItem> {
        await updateDoc(doc(db, 'reports', reportId), { status, updated_at: nowIso() })
        return readReport(reportId)
    },

    async updateContent(
        reportId: string,
        patch: {
            title?: string
            description?: string
            reproductionSteps?: string | null
            severity?: ReportSeverity | null
            type?: ReportType
        }
    ): Promise<ReportItem> {
        const steps = patch.reproductionSteps !== undefined ? cleanText(patch.reproductionSteps, 3000) : undefined
        await updateDoc(doc(db, 'reports', reportId), {
            ...(patch.title ? { title: patch.title.trim().slice(0, 140) } : {}),
            ...(patch.description ? { description: patch.description.trim().slice(0, 3000) } : {}),
            ...(steps !== undefined ? { reproduction_steps: steps, steps } : {}),
            ...(patch.severity !== undefined ? { severity: patch.severity } : {}),
            ...(patch.type ? { type: patch.type } : {}),
            updated_at: nowIso(),
        })
        return readReport(reportId)
    },

    async getViewerAccess(userId: string): Promise<{ isAdmin: boolean }> {
        const snap = await getDoc(doc(db, 'admins', userId)).catch(() => null)
        return { isAdmin: !!snap?.exists() }
    },

    async listMyAdminNotifications(userId: string): Promise<ReportNotification[]> {
        const rows = await queryDocs<ReportNotification>('report_notifications', where('admin_user_id', '==', userId))
        return rows.sort((a, b) => b.created_at.localeCompare(a.created_at))
    },

    async getUnreadAdminNotificationsCount(userId: string): Promise<number> {
        const snap = await getCountFromServer(
            query(collection(db, 'report_notifications'), where('admin_user_id', '==', userId), where('read', '==', false))
        )
        return snap.data().count
    },

    async markAllAdminNotificationsRead(userId: string): Promise<void> {
        const unread = await queryDocs<ReportNotification>('report_notifications', where('admin_user_id', '==', userId), where('read', '==', false))
        if (unread.length === 0) return
        const batch = writeBatch(db)
        for (const item of unread) batch.update(doc(db, 'report_notifications', item.id), { read: true, read_at: nowIso() })
        await batch.commit()
    },
}
