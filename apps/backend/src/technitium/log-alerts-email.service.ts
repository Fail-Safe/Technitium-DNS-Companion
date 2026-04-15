import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import type {
  LogAlertRule,
  LogAlertsSendTestEmailRequest,
  LogAlertsSendTestEmailResponse,
  LogAlertsSmtpStatus,
} from "./log-alerts.types";

type SmtpConfig = {
  host?: string;
  port?: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from?: string;
  replyTo?: string;
};

@Injectable()
export class LogAlertsEmailService {
  private transporter: Transporter | null = null;
  private transporterKey = "";

  getSmtpStatus(): LogAlertsSmtpStatus {
    const config = this.readConfig();
    const missing = this.getMissingConfigFields(config);

    return {
      configured: missing.length === 0,
      ready: missing.length === 0,
      secure: config.secure,
      host: config.host,
      port: config.port,
      from: config.from,
      authConfigured: !!config.user && !!config.pass,
      missing,
    };
  }

  async sendTestEmail(
    request: LogAlertsSendTestEmailRequest,
  ): Promise<LogAlertsSendTestEmailResponse> {
    const recipients = this.normalizeRecipients(request.to);
    if (recipients.length === 0) {
      throw new BadRequestException("At least one recipient is required.");
    }

    const now = new Date().toISOString();
    const subject =
      request.subject?.trim() ||
      "Technitium DNS Companion: Log Alert SMTP Test";
    const text =
      request.text?.trim() ||
      `This is a test email from Technitium DNS Companion log alerts.\n\nSent at: ${now}`;

    return this.sendEmail({ to: recipients, subject, text });
  }

  async sendRuleAlertEmail(params: {
    rule: LogAlertRule;
    matchedCount: number;
    latestMatchAt?: string;
    sampleLines: string[];
    dryRun?: boolean;
  }): Promise<LogAlertsSendTestEmailResponse | null> {
    const timestamp = params.latestMatchAt ?? new Date().toISOString();
    const { rule } = params;
    const displayName = rule.displayName ?? rule.name;
    const label = rule.displayName ? "Schedule" : "Rule";
    const subject = `[Technitium DNS Companion] ${rule.displayName ? "DNS Schedule alert" : "Log alert"}: ${displayName}`;

    const lines: string[] = [];
    if (rule.notifyMessage && rule.notifyMessageOnly) {
      lines.push(rule.notifyMessage);
    } else {
      if (rule.notifyMessage) {
        lines.push(rule.notifyMessage, "", "---", "");
      }
      lines.push(
        `${label}: ${displayName}`,
        `Matched entries: ${params.matchedCount}`,
        `Latest match: ${timestamp}`,
        `Outcome mode: ${rule.outcomeMode}`,
        `Pattern: ${rule.domainPatternType}:${rule.domainPattern}`,
        `Client selector: ${rule.clientIdentifier ?? "any"}`,
        `Group selector: ${rule.advancedBlockingGroupNames?.join(", ") ?? "any"}`,
        "",
        "Recent matches:",
        ...(params.sampleLines.length > 0
          ? params.sampleLines
          : ["(no sample lines)"]),
      );
    }

    if (params.dryRun) {
      return null;
    }

    return this.sendEmail({
      to: rule.emailRecipients,
      subject,
      text: lines.join("\n"),
    });
  }

  // Drift alerts are operator-only: recipients come from an admin env var,
  // not the schedule's notifyEmails (which may target the schedule's subject).
  async sendScheduleDriftAlert(params: {
    scheduleName: string;
    nodeId: string;
    consecutiveTicks: number;
    tickIntervalSeconds: number;
    revertedEntries: string[];
    recipients: string[];
  }): Promise<LogAlertsSendTestEmailResponse | null> {
    const {
      scheduleName,
      nodeId,
      consecutiveTicks,
      tickIntervalSeconds,
      revertedEntries,
      recipients,
    } = params;

    const recipientList = this.normalizeRecipients(recipients);
    if (recipientList.length === 0) return null;

    const approxDurationSeconds = consecutiveTicks * tickIntervalSeconds;
    const durationLabel =
      approxDurationSeconds >= 60
        ? `${Math.round(approxDurationSeconds / 60)} minute${approxDurationSeconds >= 120 ? "s" : ""}`
        : `${approxDurationSeconds} seconds`;

    const subject = `[Technitium DNS Companion] DNS Schedule drift detected: ${scheduleName}`;

    const lines: string[] = [];
    lines.push(
      `The DNS Schedule "${scheduleName}" is not converging to its intended state.`,
      "",
      `Node: ${nodeId}`,
      `Drift persisted: ${consecutiveTicks} consecutive evaluator ticks (~${durationLabel}).`,
      `Reverted entries (${revertedEntries.length}):`,
      ...(revertedEntries.length > 0
        ? revertedEntries.slice(0, 20).map((e) => `  - ${e}`)
        : ["  (none reported)"]),
      ...(revertedEntries.length > 20
        ? [`  … and ${revertedEntries.length - 20} more`]
        : []),
      "",
      "This usually means another process is mutating the Advanced Blocking",
      "config for this group — for example a manual edit in the Technitium UI,",
      "a Domain Groups apply that conflicts with the schedule, or an external",
      "automation. The evaluator will keep trying to enforce the schedule every",
      "tick; this alert will not re-fire until the drift resolves and recurs.",
    );

    return this.sendEmail({
      to: recipientList,
      subject,
      text: lines.join("\n"),
    });
  }

  private readConfig(): SmtpConfig {
    const host = (process.env.SMTP_HOST ?? "").trim() || undefined;
    const portRaw = (process.env.SMTP_PORT ?? "").trim();
    const port =
      portRaw.length > 0 && Number.isFinite(Number(portRaw))
        ? Number(portRaw)
        : undefined;

    const secureRaw = (process.env.SMTP_SECURE ?? "").trim().toLowerCase();
    const secure = secureRaw === "true" || secureRaw === "1";

    const user = (process.env.SMTP_USER ?? "").trim() || undefined;
    const pass = (process.env.SMTP_PASS ?? "").trim() || undefined;
    const from = (process.env.SMTP_FROM ?? "").trim() || undefined;
    const replyTo = (process.env.SMTP_REPLY_TO ?? "").trim() || undefined;

    return { host, port, secure, user, pass, from, replyTo };
  }

  private getMissingConfigFields(config: SmtpConfig): string[] {
    const missing: string[] = [];
    if (!config.host) {
      missing.push("SMTP_HOST");
    }
    if (!config.port) {
      missing.push("SMTP_PORT");
    }
    if (!config.from) {
      missing.push("SMTP_FROM");
    }
    if (!config.user) {
      missing.push("SMTP_USER");
    }
    if (!config.pass) {
      missing.push("SMTP_PASS");
    }
    return missing;
  }

  private normalizeRecipients(to: string | string[]): string[] {
    const raw = Array.isArray(to) ? to : [to];
    return raw
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }

  private async sendEmail(params: {
    to: string[];
    subject: string;
    text: string;
  }): Promise<LogAlertsSendTestEmailResponse> {
    const config = this.readConfig();
    const missing = this.getMissingConfigFields(config);

    if (missing.length > 0) {
      throw new ServiceUnavailableException({
        message: "SMTP is not fully configured.",
        missing,
      });
    }

    const transporter = this.getOrCreateTransporter(config);

    const mail: SendMailOptions = {
      from: config.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      replyTo: config.replyTo,
    };

    try {
      const result = await transporter.sendMail(mail);
      return {
        accepted: result.accepted.map((value) => String(value)),
        rejected: result.rejected.map((value) => String(value)),
        messageId: result.messageId,
        response:
          typeof result.response === "string" ? result.response : undefined,
      };
    } catch (error) {
      throw new ServiceUnavailableException(
        `Failed to send SMTP email: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private getOrCreateTransporter(config: SmtpConfig): Transporter {
    const key = [
      config.host,
      config.port,
      config.secure,
      config.user,
      config.pass,
      config.from,
    ].join("|");

    if (this.transporter && this.transporterKey === key) {
      return this.transporter;
    }

    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth:
        config.user && config.pass
          ? { user: config.user, pass: config.pass }
          : undefined,
    });
    this.transporterKey = key;

    return this.transporter;
  }
}
