import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, passkeyError, bio } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { guestAllowed } from '../lib/guest.js'
import { useState, useRef, useEffect } from 'react'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { askAddDeviceData } from '../sheets.jsx'
import { passwordOn, PasswordRegisterForm, openPasswordSignIn } from '../components/PasswordAuth.jsx'
import { openDeviceLinkRedeem } from '../components/Passkeys.jsx'
import { openLostAccess } from '../components/LostAccess.jsx'
import './Login.css'

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const inviteOnly = !!config?.invite_only
  // A password is offered only where the instance allows it (#118), and is the only choice in a
  // browser that cannot make a passkey. Where both work, the passkey stays the first one.
  const pwOn = passwordOn(config)
  const [how, setHow] = useState(webauthnOK() ? 'passkey' : 'password')
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  // Boot already fetched this; retry here only if that attempt failed, so the invite field still
  // appears on an instance whose config arrived late rather than never.
  useEffect(() => { loadConfig() }, [loadConfig])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created, and this device’s data moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Registration failed'))) }
  }
  const choose = pwOn && webauthnOK() && <>
    <Segmented options={[{ value: 'passkey', label: t('Passkey'), icon: 'fingerprint' }, { value: 'password', label: t('Password'), icon: 'key' }]}
      value={how} onChange={setHow} />
    <div style={{ height: 12 }} />
  </>
  if (pwOn && how === 'password') return <>
    <h3>{t('Create your profile')}</h3>
    {choose}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name and a password. You sign in with both.')}</div>
    <PasswordRegisterForm close={close} inviteOnly={inviteOnly} name={name} setName={setName} code={code} setCode={setCode} />
  </>
  return <>
    <h3>{t('Create your profile')}</h3>
    {choose}
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey lives on your device, so no password needed.', bio())}</div>
    <input ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only. Enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

export default function Login() {
  const { setUser, adoptProfile, setGuest } = useStore()
  const config = useStore(s => s.config)
  const canGuest = guestAllowed(config)
  const pwOn = passwordOn(config)
  const register = () => useUI.getState().openSheet(close => <RegisterSheet close={close} />)
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u, { adopt: true }); await adoptProfile(askAddDeviceData); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(passkeyError(e, t('Sign-in failed'))) }
  }
  const head = <header className="gym-login-header">
    <h1 className="gym-login-title">{t('Log In')}</h1>
    <div className="gym-login-welcome">
      <span className="gym-login-brand">HOME GYM</span>
      <h2>{t('Welcome')}</h2>
      <p>{t('Your workouts. Your weights. Your profile.')}</p>
    </div>
  </header>

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="gym-login gym-login-demo">
      {head}
      <div className="gym-login-band">
        <div className="gym-login-controls">
          <div className="gym-login-symbol" aria-hidden="true"><Icon name="dumbbell" /></div>
          <p className="gym-login-description">{t('Live demo. Everything stays in this browser.')}</p>
          <Button variant="primary" className="gym-login-signin" icon="play" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
        </div>
      </div>
      <div className="gym-login-footer">
        <p>{t('This demo runs entirely in your browser on example data. Nothing is sent anywhere. Passkey sign-in and sync across your devices come with the openGym server, which you get by self-hosting it.')}</p>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="gym-login">
      {head}
      {webauthnOK() ? <>
        <div className="gym-login-band">
          <div className="gym-login-controls">
            <div className="gym-login-symbol" aria-hidden="true"><Icon name="fingerprint" /></div>
            <p className="gym-login-description">{t('Your personal gym, one tap away.')}</p>
            <Button variant="primary" className="gym-login-signin" icon="fingerprint" onClick={signIn}>{t('Sign in with passkey')}</Button>
            {pwOn && <Button className="gym-login-signin" icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button>}
          </div>
        </div>
        <div className="gym-login-actions">
        <Button className="gym-login-create" onClick={register}>{t('Create new profile')}</Button>
        {/* Already signed in on another device: a code from there gives this one a passkey of
            its own (#95), instead of a new, empty profile. */}
        <Button variant="ghost" className="gym-login-link" icon="qr" onClick={openDeviceLinkRedeem}>{t('Use a code from your other device')}</Button>
        {/* No device signs you in any more (#584): what to try, and where a recovery code goes. */}
        <Button variant="ghost" className="gym-login-link" onClick={openLostAccess}>{t('Lost access?')}</Button>
        </div>
      </> : pwOn ? <>
        {/* Plain http on a LAN address, or a browser without passkey support: the password is
            the way in, and the only way to create a profile from here. */}
        <div className="gym-login-band">
          <div className="gym-login-controls">
            <div className="gym-login-symbol" aria-hidden="true"><Icon name="key" /></div>
            <p className="gym-login-description">{t("This browser doesn't support passkeys. Sign in with your name and password instead.")}</p>
            <Button variant="primary" className="gym-login-signin" icon="key" onClick={() => openPasswordSignIn()}>{t('Sign in with password')}</Button>
          </div>
        </div>
        <div className="gym-login-actions">
          <Button className="gym-login-create" onClick={register}>{t('Create new profile')}</Button>
          <Button variant="ghost" className="gym-login-link" onClick={openLostAccess}>{t('Lost access?')}</Button>
        </div>
      </> : <div className="gym-login-band"><div className="gym-login-controls"><p className="gym-login-description">{canGuest
          ? t("This browser doesn't do passkeys, but you can still use openGym locally on this device.")
          // Without passkeys and without the guest entrance there is no way in from this browser,
          // so say that plainly instead of offering a local profile that cannot be created.
          : t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}</p></div></div>}
      {canGuest && <div className="gym-login-guest"><Button variant="ghost" className="gym-login-link" onClick={() => setGuest(true)}>{t('Continue without account')}</Button></div>}
      <div className="gym-login-footer"><p>{pwOn ? t('Passkeys use {0}. A password works too, where passkeys do not.', bio()) : t('Passkeys use {0}. No passwords to remember.', bio())}</p><p>{t('Each profile keeps its own plan, workouts & body weight.')}</p></div>
    </div>
  )
}
