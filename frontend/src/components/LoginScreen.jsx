// LoginScreen.jsx — Pantalla de acceso (Fase 9 revisada: login por base de
// datos). Se muestra en vez de la app entera mientras no haya sesión válida.
// No hay registro propio: los usuarios se crean con
// backend/scripts/create-user.cjs (ver el script para el porqué).

import { useState } from "react";
import { login } from "../utils/storage";

export function LoginScreen({ onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError("");
    try {
      const user = await login(username.trim(), password);
      onLoginSuccess(user);
    } catch (err) {
      setError(err.message || "Usuario o contraseña incorrectos");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-screen__panel" onSubmit={handleSubmit}>
        <img src="/imagenes/logo_institucional.png" alt="Logo Corte Suprema de Justicia" className="login-screen__logo" />
        <h1 className="login-screen__title">Seguimiento Semanal</h1>
        <p className="login-screen__subtitle">Oficina de Tecnología — Corte Suprema de Justicia</p>

        <label className="login-screen__label">
          Usuario
          <input
            type="text" className="login-screen__input" value={username}
            onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username"
          />
        </label>

        <label className="login-screen__label">
          Contraseña
          <input
            type="password" className="login-screen__input" value={password}
            onChange={e => setPassword(e.target.value)} autoComplete="current-password"
          />
        </label>

        {error && <p className="login-screen__error">⚠ {error}</p>}

        <button type="submit" className="btn btn--accent login-screen__submit" disabled={loading || !username.trim() || !password}>
          {loading ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
