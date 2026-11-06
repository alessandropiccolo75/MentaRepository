export type EmailProvider = "resend" | "smtp" | "none";

export type SendResult = {
  status: "sent" | "skipped" | "failed";
  error?: string;
};

export function chooseProvider(input: { resendKey: boolean; smtpReady: boolean; from: boolean }): EmailProvider {
  if (!input.from) return "none";
  if (input.resendKey) return "resend";
  if (input.smtpReady) return "smtp";
  return "none";
}

export function emailConfigStatus() {
  const from = Boolean(process.env.EMAIL_FROM?.trim());
  const resend = Boolean(process.env.RESEND_API_KEY?.trim());
  const smtp = Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASSWORD);
  return {
    from,
    resend,
    smtp,
    provider: chooseProvider({ resendKey: resend, smtpReady: smtp, from }),
  };
}

export async function sendEmail(message: { to: string; subject: string; text: string }): Promise<SendResult> {
  if (process.env.NODE_ENV === "test") return { status: "skipped", error: "Invio disattivato nei test" };
  const to = message.to.trim().toLowerCase();
  if (!to.includes("@")) return { status: "skipped", error: "Indirizzo non valido" };
  if (to.endsWith("@example.com")) return { status: "skipped", error: "Indirizzo di esempio, invio non eseguito" };

  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const resendKey = process.env.RESEND_API_KEY?.trim() ?? "";
  const smtpHost = process.env.SMTP_HOST?.trim() ?? "";
  const smtpUser = process.env.SMTP_USER?.trim() ?? "";
  const smtpPassword = process.env.SMTP_PASSWORD ?? "";
  const provider = chooseProvider({
    resendKey: Boolean(resendKey),
    smtpReady: Boolean(smtpHost && smtpUser && smtpPassword),
    from: Boolean(from),
  });
  const subject = message.subject.replace(/[\r\n]+/g, " ").slice(0, 180);
  const text = message.text.slice(0, 8000);

  if (provider === "resend") {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${resendKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return { status: "failed", error: "Il provider email ha rifiutato il messaggio" };
      return { status: "sent" };
    } catch {
      return { status: "failed", error: "Invio email non riuscito" };
    }
  }

  if (provider === "smtp") {
    const port = Number(process.env.SMTP_PORT?.trim() || "587");
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { status: "failed", error: "SMTP_PORT non è valida" };
    }
    try {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: smtpHost,
        port,
        secure: port === 465,
        auth: { user: smtpUser, pass: smtpPassword },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000,
      });
      await transport.sendMail({ from, to, subject, text });
      return { status: "sent" };
    } catch {
      return { status: "failed", error: "Invio SMTP non riuscito" };
    }
  }

  return { status: "skipped", error: "Provider email non configurato" };
}
