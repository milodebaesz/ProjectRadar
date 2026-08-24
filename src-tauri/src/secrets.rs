//! Veilige opslag van geheimen (zoals het GitHub-token) in de OS-keychain,
//! i.p.v. plaintext in localStorage. We schillen — net als de rest van de
//! backend (osascript/git/gio) — uit naar de native CLI, zodat er geen extra
//! crate-afhankelijkheid bij komt:
//!   - macOS: `security` (login-keychain, generic password)
//!   - Linux: `secret-tool` (libsecret) indien geïnstalleerd

#[cfg(any(target_os = "macos", target_os = "linux"))]
const SERVICE: &str = "com.mkb.projectradar";

/// Bewaar (of overschrijf) een geheim onder `account`.
pub fn secret_set(account: String, value: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let out = Command::new("security")
            .args([
                "add-generic-password",
                "-U", // bestaande entry bijwerken i.p.v. dubbel toevoegen
                "-a",
                &account,
                "-s",
                SERVICE,
                "-w",
                &value,
            ])
            .output()
            .map_err(|e| format!("security kon niet starten: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    #[cfg(target_os = "linux")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};
        let mut child = Command::new("secret-tool")
            .args([
                "store",
                "--label",
                "Projectradar",
                "service",
                SERVICE,
                "account",
                &account,
            ])
            .stdin(Stdio::piped())
            .spawn()
            .map_err(|e| format!("secret-tool niet beschikbaar: {e}"))?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin
                .write_all(value.as_bytes())
                .map_err(|e| format!("secret-tool schrijven mislukt: {e}"))?;
        }
        let status = child
            .wait()
            .map_err(|e| format!("secret-tool afronden mislukt: {e}"))?;
        if status.success() {
            return Ok(());
        }
        return Err("secret-tool gaf een fout terug.".into());
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = (account, value);
        Err("Veilige opslag wordt op dit platform nog niet ondersteund.".into())
    }
}

/// Lees een geheim; None als het niet bestaat (of het platform het niet kan).
pub fn secret_get(account: String) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let out = Command::new("security")
            .args(["find-generic-password", "-a", &account, "-s", SERVICE, "-w"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let out = Command::new("secret-tool")
            .args(["lookup", "service", SERVICE, "account", &account])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = account;
        None
    }
}

/// Verwijder een geheim. Een niet-bestaand geheim is geen fout.
pub fn secret_delete(account: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let out = Command::new("security")
            .args(["delete-generic-password", "-a", &account, "-s", SERVICE])
            .output()
            .map_err(|e| format!("security kon niet starten: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        let err = String::from_utf8_lossy(&out.stderr);
        if err.contains("could not be found") {
            return Ok(());
        }
        return Err(err.trim().to_string());
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        Command::new("secret-tool")
            .args(["clear", "service", SERVICE, "account", &account])
            .output()
            .map_err(|e| format!("secret-tool niet beschikbaar: {e}"))?;
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = account;
        Ok(())
    }
}
