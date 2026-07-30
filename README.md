# Landlord's Compass

Build a professional, single-user Property Management, Accounting, Compliance, and Asset Wealth Application for an independent landlord managing an uncapped, dynamically scaling portfolio of rental properties in Australia. This app must remain entirely within the free tier by utilizing a single Landlord login, with no separate secure tenant authentication accounts or backend user role permissions. All layout data must be completely dynamic (no hardcoded read-only arrays). Use a premium, minimalist UI styling with Tailwind CSS, shadcn-like components, and Lucide icons.



APPLICATION LAYOUT & NAVIGATION:

Configure the primary interface to use a clean left-hand sidebar navigation containing five main views: Dashboard, Portfolio Manager, Rental Hub, Expenses, and AI Co-Pilot. The application must be fully mobile-responsive, collapsing the sidebar into a sliding hamburger menu on smaller screens. Include a temporary button at the top header labeled "Clear Sample Data" so the landlord can wipe out any pre-populated UI placeholders in one click to start fresh.



DATABASE STRUCTURE & RELATIONSHIPS (FULLY DYNAMIC & EDITABLE):

Ensure all tables support full CRUD (Create, Read, Update, Delete) actions from the front-end forms:

1. Properties Table: Address, Purchase Price, Current Market Value. (Uncapped limit, infinite scaling).

2. Tenants Table: Name, Email, Linked Property, Lease Start Date, Lease Expiry Date, Rent Amount, Rent Frequency (Weekly, Fortnightly, Monthly), Unique Bank Reference Code, Official Bank Account Holder Name, 'Paid Upto Date' (defaults to Lease Start Date), Bond Amount, Bond Lodgement Date, and Bond Authority Receipt Number.

3. Financial Ledger Table: Master transactional history linked to Tenant ID. Fields: Date, Transaction Type (Rent Payment, Water Invoice, Maintenance Charge, Manual Credit), Description, Amount Debit (Due), Amount Credit (Paid), and the resulting 'New Paid Upto Date'.

4. Tenant Invoices Table: Tracks separate one-off charges. Fields: Invoice ID, Tenant Link, Charge Type (Water Usage, Tenant Damage, Other), Amount Due, Date Issued, Due Date, Status (Unpaid, Paid).

5. Loans & EMIs Table: Bank Name, Total Loan Balance, Interest Rate, and Monthly EMI Payment for each property.

6. Property Expenses & Maintenance Table: Outgoings logged by Landlord. Fields: Item Name, Cost, Date, Linked Property, ATO Tax Category (Immediate Deduction vs Capital Works), Invoice File Attachment (functional simulated file upload/viewer), Has Warranty? (Toggle), Warranty Expiry Date, and Toggle: "Recharge to Tenant? (Yes/No)".

7. Inspections Table: Linked to Properties. Fields: Inspection ID, Property Link, Inspection Date, Inspection Type (Entry, Routine, Exit), Status (Scheduled, Completed), Notes, and File Attachment for Condition Report PDFs or photos.

8. Rent Changes History Table: Linked to Tenant ID. Tracks historical rent updates. Fields: Change Date, Old Rent Amount, New Rent Amount.



CORE VIEWS & FUNCTIONALITY:



VIEW 1: THE PORTFOLIO WEALTH & ALERTS DASHBOARD

- Summary Metrics: Displays Total Portfolio Value, Total Debt, Combined Remaining Equity, and a live Portfolio "Net Cash Flow" profit/loss gauge calculated as (Total Rent Received + Total Invoice Reimbursements) minus (Total EMIs + Total Property Expenses).

- Interactive visual charts tracking monthly cash flow trends and property equity growth over time.

- Proactive Reminders Panel (The 2-Month Advance Engine): Dynamically scan the Tenants table. If Today's Date is exactly 60 days (2 months) or fewer prior to a tenant's 'Lease Expiry Date', display a prominent, high-priority alert card stating: "Lease Expiring Soon: Review rent increase or renewal for [Tenant Name] at [Property Address]". Include a button to draft a rent adjustment notice.

- Asset Warranty Panel: Displays a clean list of all maintenance items or appliances whose 'Warranty Expiry Date' is approaching within the next 90 days to catch insurance/warranty claims early.

- Compliance Alerts: Flag any property that hasn't had an inspection record logged in the last 6 months.



VIEW 2: PORTFOLIO MANAGER (PROPERTIES & TENANTS INTERFACE)

- Displays a clean visual grid of the real estate assets using a responsive auto-wrap grid layout that dynamically scales to display an unlimited number of properties smoothly.

- Full Asset Control: Next to each property card, add an "Edit Property" pencil icon button and a "Delete Property" button to fully manage the list. Clicking an individual property opens an expanded view or slide-out drawer showing its purchase price, active lease agreement, asset health, and its digital document vault listing past uploaded maintenance invoices.

- Tenant Onboarding & Date Flexibility: Add an "Add Tenant" button inside any vacant property card to link a tenant profile, lease constraints, and structural dates. The 'Lease Start Date' and 'Lease Expiry Date' fields must remain completely editable post-onboarding. If a lease start date or rent amount is modified, the system must instantly recalculate and redraw the ledger history forward from that new structural milestone. Include explicit entry fields for Bond Amount, Bond Lodgement Date, and Bond Authority Receipt Number. Display a "Bond Secured" status badge when populated.



VIEW 3: RENTAL & RECONCILIATION HUB (THE DAILY FINANCIAL WORKSPACE)

- Layout Modification: Add a vertical 'Tenant Directory Filter Sidebar' on the left side of this specific workspace. The sidebar must list all tenants/properties vertically. Next to each name, show a high-visibility visual indicator: a Green dot for "Paid in Advance/Current" or a Red dot for "In Arrears". Provide a "Show All Tenants" button at the top to clear filters. Clicking a name filters the entire hub to focus exclusively on that individual.

- Onboarding Shortcut: Place a "Quick-Add Tenant" button at the top of the hub so a landlord can immediately onboard a new tenant directly from their financial workspace without changing screens.

- Continuous Rent Accounting Engine: Calculate daily rent rate based on frequency. When a rent payment is credited, advance the tenant's 'Paid Upto Date' by the exact number of days covered. Show a clear field for "Next Rent Due Date" (the day following the current 'Paid Upto Date').

- Dynamic Ledger Debit/Credit Balances: For any selected tenant, calculate every structural rent cycle milestone that has occurred chronologically from their 'Lease Start Date' to 'Today'. Display these milestones as 'Debit' rows (e.g., "Rent Due: 01/06/2026 to 07/06/2026") side-by-side with actual transaction payment 'Credit' rows. Include a running balance column on the far right that tracks cumulative debt or credit positions row-by-row. Sum up a "Total Outstanding Tenant Balance" showing Rent Arrears + Unpaid Invoices.

- Ledger Undo Engine: Add a functional trash/undo icon button next to every ledger transaction row. Deleting a posted payment must permanently remove that line item and dynamically shift the tenant's 'Paid Upto Date' and Advance/Arrears status backward by the exact matching amount of days.

- Rent Increase Compliance Log: When editing a tenant's rent amount, log the old and new rates to the history table. If a rent increase is scheduled less than 12 months from their last recorded rent change date, show a prominent legal warning message: "Compliance Notice: Rent increases are legally restricted to once every 12 months in most Australian jurisdictions." Add an "Edit Tenant Details" button to update active tenant structures seamlessly.

- Communication Template Generator: In the Tenant profile/statement screen, add a "Generate Notice" button that opens a modal with a dropdown of pre-made text templates: (A) 7-Day Friendly Arrears Notice, (B) 14-Day Formal Inspection Notice, (C) Lease Expiry & Renewal Offer. When selected, dynamically merge the tenant's name, property address, exact rent amount owed, or lease expiry date into the text for instant clipboard copy-pasting.

- Robust Bank Feed Parsing Fix: Features a simulated bank feed string text-box and a CSV file upload tool. Rewrite the parsing engine to strictly look for any dollar symbol ($) or decimal numeric string and extract that as the absolute financial value. Scan the rest of the text string for an exact match against any tenant's 'Unique Bank Reference Code' or active first/last names using case-insensitive contains logic. Require a gatekeeping confirmation modal ("Confirm matching $XX to [Tenant Name]?") before posting funds to prevent false positives.



VIEW 4: MAINTENANCE, EXPENSES & TAX REPORTING

- An intuitive dashboard interface to log any asset outgoings, utilities, routine inspections, or repairs, including an option to upload/attach an invoice file.

- Smart Automation Rule: If the landlord toggles the "Recharge to Tenant?" switch (e.g., for a water usage utility bill or tenant-induced property damage), the application must automatically generate a corresponding debit entry in the 'Tenant Invoices Table' for that amount, instantly pushing it onto that specific tenant's master statement of account as an outstanding balance.

- Date sorting filters aligned with the Australian Financial Year (1 July to 30 June) to generate clean, exportable tax sheets.

- One-Click EOFY Tax Summary: Add an "EOFY Statement Generator" button. When clicked, allow selection of a Property and an Australian Financial Year (e.g., 2025-2026). Instantly generate a single-page downloadable PDF summary displaying: Gross Rent Collected, Total Expenses Itemized by ATO Category, Total Loan Interest Paid, and Net Taxable Profit/Loss.



VIEW 5: EMBEDDED AI PORTFOLIO ASSISTANT (THE EXPERT CO-PILOT)

- Provide a full-height interactive conversational AI Chat panel view. 

- Local State Intelligence Engine: Code the assistant's underlying query routing so it actively reads the live JavaScript application state arrays or Supabase tables (Properties, Tenants, Ledgers, Expenses). 

- Contextual Analysis Capabilities: It must be programmed to handle natural language text prompts and immediately calculate/output precise data summaries based on the active portfolio information. It should accurately respond to prompt formulas such as:

  * "Who is in arrears right now?" -> Output a list of tenants with a red arrears badge and their total amount owing.

  * "Draft an overdue notice text for [Tenant Name]" -> Generate a highly professional, polite reminder message integrating their exact outstanding ledger balance.

  * "Show my highest yielding property" -> Compare rent collected against property purchase prices and display the winning address.

  * "What are my upcoming tasks?" -> Return a consolidated list of warranties expiring in 90 days and leases expiring in 60 days.

- Include a small section containing quick-clickable "Suggested AI Actions" chip buttons at the top of the chat area to demonstrate these query types seamlessly.



VIEW 6: SIMULATED TENANT VIEW TOGGLE

- Place a prominent toggle switch at the top header labeled "Switch to Tenant View" alongside a dropdown menu to choose which tenant to simulate.

- When activated, visually switch the layout to a beautiful, clean, mobile-optimized interface mimicking a tenant's personal portal. It must showcase their specific rental address, active lease expiry date, next rent due date, outstanding utilities/water bills with offline payment instructions, and a history log a

llowing them to click and download past PDF rent receipts.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://landlordmangement.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/723b10c3-3100-45d5-ba9e-c4ab2b4d14cd).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
