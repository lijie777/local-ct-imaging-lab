export const SAFETY_NOTICE = '教学演示软件，不用于临床诊断'

export function SafetyBanner() {
  return (
    <div className="safety-banner" role="note">
      {SAFETY_NOTICE}
    </div>
  )
}
