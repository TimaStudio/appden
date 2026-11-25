import React from 'react'

const REQUIRED_VARS: Array<[name: string, value: string | undefined]> = [
    ['VITE_FIREBASE_API_KEY', import.meta.env.VITE_FIREBASE_API_KEY as string | undefined],
    ['VITE_FIREBASE_AUTH_DOMAIN', import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined],
    ['VITE_FIREBASE_PROJECT_ID', import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined],
    ['VITE_FIREBASE_APP_ID', import.meta.env.VITE_FIREBASE_APP_ID as string | undefined],
    ['VITE_STORAGE_URL', import.meta.env.VITE_STORAGE_URL as string | undefined],
]

/** Setup check: shows which environment variables are missing. */
export const DiagnosticPage: React.FC = () => {
    const overridden = REQUIRED_VARS.filter(([, value]) => !!value?.trim()).length

    return (
        <div className="min-h-screen bg-neutral-900 p-6">
            <div className="mx-auto max-w-2xl">
                <h1 className="mb-6 text-3xl font-bold text-white">Diagnóstico</h1>

                <div className="mb-6 rounded-lg border border-neutral-700 bg-neutral-800 p-6">
                    <h2 className="mb-4 text-xl font-semibold text-white">Variables de entorno</h2>
                    <div className="space-y-3 font-mono text-sm">
                        {REQUIRED_VARS.map(([name, value]) => (
                            <div key={name} className="flex items-start gap-3">
                                <span>{value?.trim() ? '✅' : '➖'}</span>
                                <span className="text-neutral-200">{name}</span>
                                <span className="text-neutral-500">{value?.trim() ? 'personalizada' : 'valor por defecto (producción)'}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="mb-6 rounded-lg border border-neutral-700 bg-neutral-800 p-6 text-sm text-neutral-300">
                    {overridden === 0
                        ? 'Se usa la configuración de producción (proyecto appdenski y Worker appden-storage).'
                        : 'Las variables personalizadas sustituyen a la configuración de producción.'}{' '}
                    Si no puedes entrar, revisa tu conexión y que este dominio esté autorizado en Firebase Authentication.
                </div>
            </div>
        </div>
    )
}
