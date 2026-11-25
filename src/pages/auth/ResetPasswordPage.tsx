import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2, MailCheck } from 'lucide-react'
import { authErrorMessage, authService } from '@services/auth.service'
import {
    resetPasswordSchema,
    updatePasswordSchema,
    type ResetPasswordFormData,
    type UpdatePasswordFormData,
} from '@lib/validators'
import { useToast } from '@components/ui/Toast'
import { AuthShell, PasswordInput } from '@components/layout/AuthShell'
import { ROUTES } from '@lib/constants'

type Mode = 'checking' | 'request' | 'sent' | 'update' | 'updated'

/** Code from a Firebase password reset link (`?mode=resetPassword&oobCode=…`). */
function resetCodeFromUrl(): string | null {
    const query = new URLSearchParams(window.location.search)
    return query.get('mode') === 'resetPassword' ? query.get('oobCode') : null
}

const ResetPasswordPage: React.FC = () => {
    const navigate = useNavigate()
    const { error: toastError } = useToast()
    const [resetCode] = useState(resetCodeFromUrl)
    const [mode, setMode] = useState<Mode>(resetCode ? 'checking' : 'request')

    const requestForm = useForm<ResetPasswordFormData>({ resolver: zodResolver(resetPasswordSchema) })
    const updateForm = useForm<UpdatePasswordFormData>({ resolver: zodResolver(updatePasswordSchema) })

    useEffect(() => {
        if (!resetCode) return
        let cancelled = false
        authService
            .verifyResetCode(resetCode)
            .then(() => {
                if (!cancelled) setMode('update')
            })
            .catch(() => {
                if (cancelled) return
                toastError('El enlace no es válido o ha caducado', 'Pide uno nuevo desde aquí.')
                setMode('request')
            })
        return () => {
            cancelled = true
        }
    }, [resetCode, toastError])

    const onRequestSubmit = async (data: ResetPasswordFormData) => {
        try {
            await authService.resetPassword(data.email.trim())
            setMode('sent')
        } catch (err: unknown) {
            // Don't reveal whether the email has an account.
            if (err instanceof Error && err.message.includes('user-not-found')) {
                setMode('sent')
                return
            }
            toastError('No se pudo enviar el email', authErrorMessage(err))
        }
    }

    const onUpdateSubmit = async (data: UpdatePasswordFormData) => {
        if (!resetCode) return
        try {
            await authService.confirmReset(resetCode, data.password)
            setMode('updated')
        } catch (err: unknown) {
            toastError('No se pudo actualizar la contraseña', authErrorMessage(err))
        }
    }

    const footer = (
        <Link to={ROUTES.LOGIN} className="font-semibold text-brand-300">
            Volver a iniciar sesión
        </Link>
    )

    if (mode === 'checking') {
        return (
            <AuthShell title="Un momento…" subtitle="Comprobando el enlace de recuperación.">
                <div className="grid place-items-center py-8">
                    <span className="h-8 w-8 animate-spin rounded-full border-2 border-brand-300 border-t-transparent" />
                </div>
            </AuthShell>
        )
    }

    if (mode === 'sent' || mode === 'updated') {
        const sent = mode === 'sent'
        return (
            <AuthShell
                title={sent ? 'Revisa tu email' : 'Contraseña cambiada'}
                subtitle={
                    sent
                        ? 'Si existe una cuenta con ese email, te hemos enviado un enlace para crear una contraseña nueva. Mira también en spam.'
                        : 'Ya puedes entrar con tu nueva contraseña.'
                }
                footer={sent ? footer : undefined}
            >
                <div className="card flex items-center gap-3 p-4">
                    {sent ? <MailCheck className="h-6 w-6 shrink-0 text-brand-300" /> : <CheckCircle2 className="h-6 w-6 shrink-0 text-emerald-300" />}
                    <p className="text-sm text-gray-300">{sent ? 'El enlace caduca en una hora.' : 'Ya puedes usarla en todos tus dispositivos.'}</p>
                </div>
                {!sent ? (
                    <button type="button" onClick={() => navigate(ROUTES.LOGIN, { replace: true })} className="btn-primary mt-4 w-full !min-h-[3.25rem]">
                        Iniciar sesión
                    </button>
                ) : null}
            </AuthShell>
        )
    }

    if (mode === 'update') {
        const { register, handleSubmit, formState } = updateForm
        return (
            <AuthShell title="Crea una contraseña nueva" subtitle="Mínimo 8 caracteres. Que no sea la de siempre 😉">
                <form onSubmit={handleSubmit(onUpdateSubmit)} className="space-y-4" noValidate>
                    <div>
                        <label className="label" htmlFor="password">Nueva contraseña</label>
                        <PasswordInput id="password" autoComplete="new-password" invalid={!!formState.errors.password} {...register('password')} />
                        {formState.errors.password ? <p className="field-error">{formState.errors.password.message}</p> : null}
                    </div>
                    <div>
                        <label className="label" htmlFor="confirmPassword">Repite la contraseña</label>
                        <PasswordInput id="confirmPassword" autoComplete="new-password" invalid={!!formState.errors.confirmPassword} {...register('confirmPassword')} />
                        {formState.errors.confirmPassword ? <p className="field-error">{formState.errors.confirmPassword.message}</p> : null}
                    </div>
                    <button type="submit" disabled={formState.isSubmitting} className="btn-primary w-full !min-h-[3.25rem] text-base">
                        {formState.isSubmitting ? 'Guardando…' : 'Guardar contraseña'}
                    </button>
                </form>
            </AuthShell>
        )
    }

    const { register, handleSubmit, formState } = requestForm
    return (
        <AuthShell title="¿Has olvidado la contraseña?" subtitle="Te enviaremos un enlace para crear una nueva." footer={footer}>
            <form onSubmit={handleSubmit(onRequestSubmit)} className="space-y-4" noValidate>
                <div>
                    <label className="label" htmlFor="email">Email</label>
                    <input
                        id="email"
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        autoCapitalize="none"
                        placeholder="tu@email.com"
                        className={`input ${formState.errors.email ? '!border-red-400/60' : ''}`}
                        {...register('email')}
                    />
                    {formState.errors.email ? <p className="field-error">{formState.errors.email.message}</p> : null}
                </div>
                <button type="submit" disabled={formState.isSubmitting} className="btn-primary w-full !min-h-[3.25rem] text-base">
                    {formState.isSubmitting ? 'Enviando…' : 'Enviar enlace'}
                </button>
            </form>
        </AuthShell>
    )
}

export default ResetPasswordPage
