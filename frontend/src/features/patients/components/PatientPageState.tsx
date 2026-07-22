interface PatientPageStateProps {
  kind: 'loading' | 'empty' | 'error'
  message: string
}

export function PatientPageState({ kind, message }: PatientPageStateProps) {
  return (
    <section
      className={`patient-page-state patient-page-state--${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <p>{message}</p>
    </section>
  )
}
