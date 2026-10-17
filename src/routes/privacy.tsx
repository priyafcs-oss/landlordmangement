import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalContact, LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Landlord OS" },
      {
        name: "description",
        content:
          "How Landlord OS collects, uses and protects your data, including Google user data.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        Landlord OS is a property-management app for landlords. It keeps track of properties,
        tenants, leases, bills, loans, expenses and their documents. This policy explains what data
        the app handles, why, and the choices you have.
      </p>

      <section>
        <h2>What we collect</h2>
        <ul>
          <li>
            <strong>Account details</strong>: your email address and password (stored hashed by our
            authentication provider), plus failed sign-in attempts, which we keep briefly to lock
            out password guessing.
          </li>
          <li>
            <strong>Portfolio data you enter or upload</strong>: properties, tenants and their
            contact details, leases, rent records, bills, loans, expenses, inspections and
            maintenance requests, and the documents attached to them.
          </li>
          <li>
            <strong>Maintenance requests</strong> submitted by tenants on the public form, including
            any contact details and photos they choose to provide.
          </li>
          <li>
            <strong>Bills forwarded by email</strong> to the app's receiving address, with their
            attachments.
          </li>
        </ul>
      </section>

      <section>
        <h2>Google user data</h2>
        <p>
          If you choose to connect Google Drive in Settings, the app asks only for the{" "}
          <code>drive.file</code> permission. That lets it create, read, move and organise the files{" "}
          <em>it uploads itself</em> into a "Landlord OS Documents" folder in your Drive. It cannot
          see, read or change any other file in your Drive. The app also reads the email address of
          the connected Google account, to show which account is linked.
        </p>
        <p>
          The app uses this access only to store your documents in your own Drive, open them when
          you view them in the app, and file them into property and financial-year folders. Your
          Google access token is stored encrypted and is used only by the app's server functions to
          do those things on your behalf.
        </p>
        <p>
          Landlord OS's use and transfer of information received from Google APIs adheres to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google user data is not sold, not used for
          advertising, not used to train AI or machine-learning models, and not shared with anyone
          except as needed to provide the features above, to comply with the law, or with your
          consent. No person reads your Drive files except you, or someone you ask to help with a
          support request about a specific file.
        </p>
      </section>

      <section>
        <h2>How we use your data</h2>
        <ul>
          <li>
            To run the app for you: show your portfolio, calculate rent, bills, loans and tax
            figures, and draft tenant emails.
          </li>
          <li>
            To read documents you upload or forward (for example a bill PDF) and suggest the details
            to fill in. The document is sent to an AI service for this one task, and the result is
            shown to you for review before anything is saved.
          </li>
          <li>To keep your account secure.</li>
        </ul>
        <p>
          We do not sell your data, show advertising, or use your data for any purpose unrelated to
          the app.
        </p>
      </section>

      <section>
        <h2>Who processes data for us</h2>
        <ul>
          <li>Supabase: database, sign-in and file storage.</li>
          <li>Vercel: hosts the website.</li>
          <li>
            Google: Drive storage (if you connect it) and the Gemini AI service that reads uploaded
            documents.
          </li>
          <li>Resend: receives bills forwarded by email.</li>
          <li>Domain (domain.com.au): property address and value lookups.</li>
        </ul>
      </section>

      <section>
        <h2>Who can see your data</h2>
        <p>
          Each account's portfolio is completely separate: the database only ever returns your own
          records to you. Other users of the app cannot see your properties, tenants, documents or
          any other data.
        </p>
      </section>

      <section>
        <h2>Your choices</h2>
        <ul>
          <li>Edit or delete any record or document in the app at any time.</li>
          <li>
            Disconnect Google Drive in Settings → Connected Google Drive, or revoke access at{" "}
            <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">
              myaccount.google.com/permissions
            </a>
            . Disconnecting deletes the stored access token. Files already in your Drive stay there,
            and they are yours.
          </li>
          <li>Ask us to delete your account and all of its data.</li>
        </ul>
      </section>

      <section>
        <h2>Retention and security</h2>
        <p>
          Your data is kept while your account exists and deleted when you ask us to delete the
          account. Data is encrypted in transit, sign-in is required for everything except the
          public maintenance form, and access tokens are stored encrypted.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          If this policy changes, the date at the top will change too. See also the{" "}
          <Link to="/terms">Terms of Service</Link>.
        </p>
      </section>

      <LegalContact />
    </LegalPage>
  );
}
