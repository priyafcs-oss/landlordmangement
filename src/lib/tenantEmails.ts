import { toast } from "sonner";
import { fmtCurrency } from "@/lib/calculations";
import { downloadPdfAndEmailViaGmail, openGmailCompose } from "@/lib/emailPdf";
import { resolveDocumentBlob } from "@/lib/files";
import type { Tenant } from "@/lib/types";

export interface EmailMessage {
  subject: string;
  body: string;
}

/** The email asking a tenant to pay a charge recharged to them from a bill or expense line. */
export function rechargeEmail(input: {
  tenantName: string;
  propertyLabel?: string;
  billType: string;
  description: string;
  amount: number;
}): EmailMessage {
  const { tenantName, propertyLabel, billType, description, amount } = input;
  const what = description || "usage charge";
  return {
    subject: `${billType} — ${what} (${fmtCurrency(amount)})`,
    body: `Hi ${tenantName},\n\nThe ${propertyLabel || "property"} ${billType.toLowerCase()} bill has come in. It includes a charge of ${fmtCurrency(amount)} for "${what}" that's payable by you under the lease — the full bill is attached for your records.\n\nCould you arrange payment of ${fmtCurrency(amount)} at your earliest convenience?\n\nThanks`,
  };
}

/**
 * Opens a Gmail draft to a tenant. No browser email client can attach a file automatically (a
 * security restriction, not something this app can work around), so with a document it's
 * downloaded first and the landlord attaches it to the draft that opens.
 */
export async function emailTenant(
  tenant: Pick<Tenant, "name" | "email"> | undefined,
  message: EmailMessage,
  attachment?: { fileName?: string; fileData?: string },
): Promise<void> {
  if (!tenant) {
    toast.error("Select a tenant first");
    return;
  }
  // Still open the draft — the landlord can type the address in.
  if (!tenant.email)
    toast.warning(`No email address on file for ${tenant.name} — add it in the draft`);
  const blob = attachment?.fileData
    ? await resolveDocumentBlob(attachment.fileName, attachment.fileData)
    : null;
  if (blob) {
    downloadPdfAndEmailViaGmail({
      blob,
      fileName: attachment?.fileName || "bill.pdf",
      to: tenant.email,
      ...message,
    });
    toast.success("Bill downloaded — attach it in the Gmail draft that just opened");
  } else {
    openGmailCompose(tenant.email, message.subject, message.body);
    if (attachment) toast("No source document on this bill — compose opened without an attachment");
  }
}
