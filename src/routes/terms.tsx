import { createFileRoute, Link } from "@tanstack/react-router";
import { LegalContact, LegalPage } from "@/components/LegalPage";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — Landlord OS" },
      { name: "description", content: "The terms for using Landlord OS." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalPage title="Terms of Service">
      <p>By creating an account or using Landlord OS ("the app"), you agree to these terms.</p>

      <section>
        <h2>The service</h2>
        <p>
          Landlord OS helps landlords record and organise properties, tenants, leases, rent, bills,
          loans, expenses and documents. It can store documents in your own Google Drive if you
          connect it, and it can use AI to suggest details from documents you upload.
        </p>
      </section>

      <section>
        <h2>Your account</h2>
        <ul>
          <li>Keep your password safe. You are responsible for activity on your account.</li>
          <li>
            Only enter data you have the right to hold, including your tenants' personal details,
            and handle it lawfully.
          </li>
          <li>
            Do not misuse the app, attempt to access other users' data, or interfere with how it
            runs.
          </li>
        </ul>
      </section>

      <section>
        <h2>Your data</h2>
        <p>
          You own the data and documents you put into the app. You give us permission to store and
          process them only to provide the app to you. How we handle them is described in the{" "}
          <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </section>

      <section>
        <h2>Not professional advice</h2>
        <p>
          Figures, forecasts, tax and depreciation summaries, and AI-suggested details are a
          record-keeping aid. They may contain mistakes. Check them before relying on them, and get
          advice from a qualified accountant, lawyer or financial adviser for tax, legal or
          financial decisions.
        </p>
      </section>

      <section>
        <h2>Availability</h2>
        <p>
          The app is provided "as is". We aim to keep it running and your data safe, but we can't
          promise it will always be available or error-free. Keep your own copies of important
          documents (connecting Google Drive does this for you).
        </p>
      </section>

      <section>
        <h2>Liability</h2>
        <p>
          To the extent the law allows, we are not liable for indirect or consequential loss, or for
          loss caused by relying on figures in the app without checking them. Nothing in these terms
          excludes rights you have under Australian Consumer Law that cannot be excluded.
        </p>
      </section>

      <section>
        <h2>Ending your use</h2>
        <p>
          You can stop using the app at any time, disconnect Google Drive in Settings, and ask us to
          delete your account. We may suspend an account that breaks these terms.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>
          If these terms change, the date at the top will change too. Continuing to use the app
          means you accept the new terms.
        </p>
      </section>

      <LegalContact />
    </LegalPage>
  );
}
