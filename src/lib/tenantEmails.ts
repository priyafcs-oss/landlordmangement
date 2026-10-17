import { toast } from "sonner";
import { fmtCurrency } from "@/lib/calculations";
import { downloadPdfAndEmailViaGmail, openGmailCompose } from "@/lib/emailPdf";
import { resolveDocumentBlob } from "@/lib/files";
import type { Tenant } from "@/lib/types";

/**
 * Every email the app drafts to a tenant — one builder each, one sign-off, one way to open the
 * draft. They used to be written inline in five screens with three different sign-offs ("Thanks"
 * with no name, "The Landlord", or the landlord's name).
 */

export interface EmailMessage {
  subject: string;
  body: string;
}

/** "Thanks,\nJane Smith" — the landlord's own name from Settings, or "The Landlord". */
export function signOff(
  landlordName: string | undefined,
  closing: "Thanks" | "Kind regards" = "Thanks",
): string {
  return `${closing},\n${landlordName?.trim() || "The Landlord"}`;
}

/** Asking a tenant to pay a charge recharged to them from a bill or expense line. */
export function rechargeEmail(input: {
  tenantName: string;
  propertyLabel?: string;
  billType: string;
  description: string;
  amount: number;
  landlordName?: string;
}): EmailMessage {
  const { tenantName, propertyLabel, billType, description, amount } = input;
  const what = description || "usage charge";
  return {
    subject: `${billType} — ${what} (${fmtCurrency(amount)})`,
    body: `Hi ${tenantName},\n\nThe ${propertyLabel || "property"} ${billType.toLowerCase()} bill has come in. It includes a charge of ${fmtCurrency(amount)} for "${what}" that's payable by you under the lease — the full bill is attached for your records.\n\nCould you arrange payment of ${fmtCurrency(amount)} at your earliest convenience?\n\n${signOff(input.landlordName)}`,
  };
}

/** An upcoming inspection heads-up, or (once done) a short follow-up on it. */
export function inspectionEmail(input: {
  tenantName: string;
  propertyLabel: string;
  inspectionType: string;
  date: string;
  completed?: boolean;
  landlordName?: string;
}): EmailMessage {
  const type = input.inspectionType.toLowerCase();
  return input.completed
    ? {
        subject: `Inspection — ${input.propertyLabel}`,
        body: `Hi ${input.tenantName},\n\nFollowing up on the ${type} inspection on ${input.date}.\n\n${signOff(input.landlordName)}`,
      }
    : {
        subject: `Upcoming ${type} inspection — ${input.propertyLabel}`,
        body: `Hi ${input.tenantName},\n\nJust a heads up that a ${type} inspection is scheduled for ${input.date} at ${input.propertyLabel}.\n\nPlease let us know if this time doesn't work.\n\n${signOff(input.landlordName)}`,
      };
}

/** Following up an issue noted at an inspection. */
export function inspectionIssueEmail(input: {
  tenantName: string;
  propertyLabel: string;
  inspectionType: string;
  issue: string;
  landlordName?: string;
}): EmailMessage {
  return {
    subject: `Follow-up from ${input.inspectionType.toLowerCase()} inspection — ${input.propertyLabel}`,
    body: `Hi ${input.tenantName},\n\nFollowing up on the recent inspection — we noted: ${input.issue}\n\nCould you let us know a good time to address this, or if it's already resolved?\n\n${signOff(input.landlordName)}`,
  };
}

/** Confirming a rent payment, with the ledger's own paid-up-to date. */
export function rentReceivedEmail(input: {
  tenantName: string;
  propertyLabel?: string;
  amount: number;
  date?: string;
  paidUpTo?: string;
  landlordName?: string;
}): EmailMessage {
  return {
    subject: `Rent received — ${input.propertyLabel || "your rental"}`,
    body: `Hi ${input.tenantName},\n\nWe've received your rent payment of ${fmtCurrency(input.amount)}${input.date ? ` on ${input.date}` : ""}.${input.paidUpTo ? `\n\nYou are now paid up to ${input.paidUpTo}.` : ""}\n\n${signOff(input.landlordName)}`,
  };
}

/** Sending the tenant their rent ledger statement (PDF attached by hand). */
export function ledgerEmail(input: {
  tenantName: string;
  propertyLabel?: string;
  totalOutstanding: number;
  paidUpTo?: string;
  landlordName?: string;
}): EmailMessage {
  return {
    subject: `Rent ledger — ${input.propertyLabel ?? ""}`.trim(),
    body: `Dear ${input.tenantName},\n\nPlease find your rent ledger statement for ${input.propertyLabel ?? "your rental"} attached to this email — I've just downloaded it as a PDF; please attach the file (from your Downloads) before sending.\n\nTotal outstanding: ${fmtCurrency(input.totalOutstanding)}\nPaid up to: ${input.paidUpTo ?? "—"}\n\n${signOff(input.landlordName, "Kind regards")}`,
  };
}

/** Sending a generated tenancy agreement (PDF attached by hand). */
export function leaseEmail(input: {
  tenantName: string;
  propertyLabel: string;
  landlordName?: string;
}): EmailMessage {
  return {
    subject: `Tenancy agreement — ${input.propertyLabel}`,
    body: `Dear ${input.tenantName},\n\nPlease find your tenancy agreement for ${input.propertyLabel} attached to this email — I've just downloaded it as a PDF; please attach the file (from your Downloads) before sending.\n\n${signOff(input.landlordName, "Kind regards")}`,
  };
}

/**
 * Opens a Gmail draft to a tenant. No browser email client can attach a file automatically (a
 * security restriction, not something this app can work around), so with a document it's
 * downloaded first and the landlord attaches it to the draft that opens. A tenant with no email
 * address still gets the draft (with a warning), so the address can be typed in.
 */
export async function emailTenant(
  tenant: Pick<Tenant, "name" | "email"> | undefined,
  message: EmailMessage,
  attachment?: { fileName?: string; fileData?: string; blob?: Blob },
): Promise<void> {
  if (!tenant) {
    toast.error("Select a tenant first");
    return;
  }
  if (!tenant.email)
    toast.warning(`No email address on file for ${tenant.name} — add it in the draft`);
  const blob =
    attachment?.blob ??
    (attachment?.fileData
      ? await resolveDocumentBlob(attachment.fileName, attachment.fileData)
      : null);
  if (blob) {
    downloadPdfAndEmailViaGmail({
      blob,
      fileName: attachment?.fileName || "document.pdf",
      to: tenant.email,
      ...message,
    });
    toast.success("Document downloaded — attach it in the Gmail draft that just opened");
  } else {
    openGmailCompose(tenant.email, message.subject, message.body);
    if (attachment) toast("No source document — compose opened without an attachment");
  }
}
