Build a professional invoice generator web app with the following specs:

---

FONTS
- Heading / UI labels: Manrope (import from Google Fonts)
- Body / input fields / table data: Inter (import from Google Fonts)

---

COLOR SYSTEM
- Background: #FFFFFF (pure white)
- Primary text: #000000 (pure black)
- Borders / dividers: #E0E0E0 (light gray)
- Muted text / labels: #6B6B6B
- Accent (CTAs, totals, highlights): #22C55E (green-500)
- Accent hover: #16A34A (green-600)
- Invoice preview background: #F5F5F5

---

LAYOUT — TWO COLUMN DESKTOP
Left panel (45% width): Form editor
Right panel (55% width): Live invoice preview

---

LEFT PANEL — FORM EDITOR

Section 1: Invoice Meta
- Auto-generated Invoice ID (format: INV-XXXXXX, random 6-digit number on load, shown as read-only with a refresh icon button beside it)
- Issue Date (date picker, default today)
- Due Date (date picker)

Section 2: Bill To (Client Info)
- Client Name (text input)
- Client Email (text input)
- Client Address (textarea, 2 rows)

Section 3: Line Items Table
Columns: Item Description | Qty | Unit Price | Total
- Each row: text input for description, number input for qty, number input for unit price, auto-calculated total (qty × unit price, read-only)
- "Add Item" button (green accent, + icon) adds a new row
- Each row has a trash icon to delete it
- Minimum 1 row always present

Section 4: Summary
- Subtotal (auto-calculated)
- Tax % input (number, default 0)
- Tax Amount (auto-calculated)
- Total Due (large, bold, green accent color)

Section 5: Notes
- Optional textarea (e.g., "Payment due within 30 days")

Primary CTA: "Preview Invoice" button (full width, black background, white text, Manrope font, bold)

---

RIGHT PANEL — INVOICE PREVIEW

Render a styled, pixel-perfect invoice preview that updates live as the user types. The preview should look like a real printed document on a white card with a subtle drop shadow.

Invoice layout (top to bottom):
1. Header row:
   - Left: Default company logo (use a minimal black square placeholder with white text "LOGO")
   - Right: Company name "Acme Studio" in Manrope bold, address "123 Design Street, San Francisco, CA 94103", email "hello@acmestudio.com"
2. Thin black divider line
3. "INVOICE" label (Manrope, uppercase, large, bold, black) left-aligned, Invoice ID and dates right-aligned
4. Two columns: "FROM" (Acme Studio details) and "BILL TO" (client info from form)
5. Thin black divider line
6. Line items table:
   - Header row: black background, white text, Manrope uppercase labels
   - Data rows: alternating white / #FAFAFA backgrounds, Inter font
   - Last column (Total) right-aligned
7. Right-aligned summary block: Subtotal, Tax, and Total Due (Total Due in green accent, larger font)
8. Thin divider, then Notes section in small Inter italic
9. Footer: "Thank you for your business." centered, small Manrope, gray

Below the preview, render two buttons side by side:
- "Edit" (white background, black border)
- "Download PDF" (green accent background, white text, Manrope bold)

---

FUNCTIONALITY

- All totals (row totals, subtotal, tax, total due) recalculate automatically on any input change
- Invoice ID regenerates with the refresh icon button click
- "Download PDF" uses window.print() or jsPDF to export only the invoice preview panel as a PDF, black and white with green accents preserved
- Show a toast notification "Invoice downloaded!" after PDF export
- Responsive: on mobile, stack the panels vertically with the preview below the form; collapse preview by default on mobile with a toggle "Preview Invoice" button

---

AESTHETIC DETAILS
- All inputs: 1px solid #E0E0E0 border, 8px border radius, Inter font
- Section titles in Manrope semibold, uppercase, small letter-spacing, black
- Green accent used ONLY on: Total Due amount, Add Item button, Download PDF button, active input focus ring
- The invoice preview card has: white background, 1px solid #E0E0E0 border, 16px border radius, 24px box shadow
- Buttons have smooth 200ms hover transitions
- No gradients. No shadows on text. Clean, editorial, structured.