import jsPDF from "jspdf";
import {
  formatQuoteDate,
  lineAmount,
  parseISODate,
  roundMoney,
} from "./types/quote";

/** Mirrors the LineItem/InvoiceData declared in App.tsx. Kept local because
 *  App.tsx imports this module, and importing back would be a cycle. */
interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  /** Authoritative line total when present — see displayAmount(). */
  amount?: number;
}

interface InvoiceData {
  invoiceId: string;
  issueDate: string;
  dueDate: string;
  clientName: string;
  clientAddress: string;
  clientCity: string;
  clientState: string;
  clientZip: string;
  clientCountry: string;
  lineItems: LineItem[];
  taxPercent: number;
  notes: string;
  currency?: string;
  sourceQuoteId?: string;
  sourceQuoteNumber?: string;
  servicePeriodStart?: string;
  servicePeriodEnd?: string;
  invoiceKind?: string;
}

interface CompanySettings {
  companyName: string;
  companyAddress: string;
  companyEmail?: string;
  companyPhone?: string;
}

/** Same embedded faces as the quote export, so the two documents match. */
const SANS = "Manrope";

/**
 * What a line is worth, in one place.
 *
 * `amount` is what the database computed and stored, and it wins whenever it
 * is there: Postgres numeric and JavaScript binary floats disagree even on
 * plain 2-decimal input — 1.01 x 18.50 is 18.69 in the database and 18.68 in
 * JS, because 18.685 * 100 is 1868.4999999999998. A downloaded PDF is a copy
 * of a stored record, so it must print what was stored. The multiplication is
 * only the fallback, for a hand-entered line the server has never totalled.
 */
const displayAmount = (item: LineItem): number =>
  typeof item.amount === "number" && Number.isFinite(item.amount)
    ? roundMoney(item.amount)
    : lineAmount(item);

/**
 * The one place an amount becomes text. Every "$" in this document comes from
 * here, so a EUR invoice cannot pick up a dollar sign from a stray template
 * string. Non-USD prints the ISO code instead of a symbol ("EUR 399.00"),
 * because the same glyph means different money in different countries.
 *
 * Zero is money and prints as 0.00; the em-dash is reserved for an amount that
 * is genuinely unknown.
 */
const moneyIn = (currency?: string) => {
  const code = (currency || "").trim().toUpperCase() || "USD";
  return (n: number | null | undefined): string => {
    if (n === null || n === undefined || !Number.isFinite(Number(n))) return "—";
    const value = roundMoney(Number(n)).toFixed(2);
    return code === "USD" ? `$${value}` : `${code} ${value}`;
  };
};

/**
 * "August 1 – August 31, 2026" for a period inside one year, otherwise both
 * years spelled out. Returns null when neither end is a usable date, so the
 * caller can drop the line entirely rather than print an empty label.
 */
const servicePeriodRange = (
  start?: string,
  end?: string,
): string | null => {
  const from = parseISODate(start);
  const to = parseISODate(end);
  if (!from && !to) return null;
  const sameYear =
    from && to && from.getFullYear() === to.getFullYear();
  const fromLabel = sameYear
    ? from!.toLocaleDateString("en-US", { month: "long", day: "numeric" })
    : formatQuoteDate(start);
  return `${fromLabel} – ${formatQuoteDate(end)}`;
};

export async function generateInvoicePDF(
  invoiceData: InvoiceData,
  subtotal: number,
  tax: number,
  total: number,
  logoImage: string,
  logoWidth: number,
  logoHeight: number,
  companySettings?: CompanySettings,
) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  // Loaded on demand; see pdf-fonts.ts. Without this the invoice renders in
  // Helvetica while the on-screen preview uses Manrope.
  const { MANROPE_REGULAR, MANROPE_BOLD } = await import("./pdf-fonts");
  pdf.addFileToVFS("Manrope-Regular.ttf", MANROPE_REGULAR);
  pdf.addFont("Manrope-Regular.ttf", SANS, "normal");
  pdf.addFileToVFS("Manrope-Bold.ttf", MANROPE_BOLD);
  pdf.addFont("Manrope-Bold.ttf", SANS, "bold");

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  let yPos = margin;

  const money = moneyIn(invoiceData.currency);

  // Helper to add text
  const addText = (
    text: string,
    x: number,
    y: number,
    options?: any,
  ) => {
    pdf.setFont(
      options?.font || SANS,
      options?.style === "italic" ? "normal" : options?.style || "normal",
    );
    pdf.setFontSize(options?.size || 10);
    pdf.setTextColor(options?.color || "#000000");
    pdf.text(
      text,
      x,
      y,
      options?.align ? { align: options.align } : undefined,
    );
  };

  // Helper to draw line
  const drawLine = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color = "#000000",
  ) => {
    pdf.setDrawColor(color);
    pdf.setLineWidth(1);
    pdf.line(x1, y1, x2, y2);
  };

  // === HEADER ===
  // Add Logo (expects PNG data URL)
  const logoSize = 32;
  try {
    pdf.addImage(
      logoImage,
      "PNG",
      margin,
      yPos,
      logoWidth,
      logoHeight,
    );
  } catch (e) {
    console.error("Error adding logo to PDF:", e);
    // Fallback to simplified logo if image fails
    pdf.setFillColor(0, 0, 0);
    pdf.roundedRect(
      margin,
      yPos,
      logoSize,
      logoSize,
      3,
      3,
      "F",
    );
    pdf.setFillColor(255, 255, 255);
    pdf.rect(margin + 6, yPos + 6, 5, 20, "F");
    pdf.rect(margin + 14, yPos + 6, 12, 13, "F");
  }

  // Company name next to logo
  const companyName =
    companySettings?.companyName || "UnitPulse";
  addText(companyName, margin + logoWidth + 12, yPos + logoHeight / 2 + 6, {
    size: 16,
    style: "bold",
  });

  // Company address (right side)
  let rightY = yPos + 2;
  addText(companyName, pageWidth - margin, rightY, {
    size: 10,
    style: "bold",
    align: "right",
  });
  rightY += 14;

  // Parse and display address lines
  const addressLines = (
    companySettings?.companyAddress ||
    "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States"
  ).split("\n");
  addressLines.forEach((line) => {
    addText(line.trim(), pageWidth - margin, rightY, {
      size: 9,
      color: "#71717B",
      align: "right",
    });
    rightY += 13;
  });

  // Add email if provided
  if (companySettings?.companyEmail) {
    addText(
      companySettings.companyEmail,
      pageWidth - margin,
      rightY,
      {
        size: 9,
        color: "#71717B",
        align: "right",
      },
    );
    rightY += 13;
  }

  // Add phone if provided
  if (companySettings?.companyPhone) {
    addText(
      companySettings.companyPhone,
      pageWidth - margin,
      rightY,
      {
        size: 9,
        color: "#71717B",
        align: "right",
      },
    );
    rightY += 13;
  }

  yPos = Math.max(yPos + logoHeight + 18, rightY + 5);

  // === DIVIDER LINE ===
  drawLine(margin, yPos, pageWidth - margin, yPos);
  yPos += 32;

  // === INVOICE TITLE & META ===
  const invoiceTitleY = yPos;
  addText("INVOICE", margin, invoiceTitleY + 8, {
    size: 36,
    style: "bold",
  });

  // Invoice meta (right side) - aligned with INVOICE title
  let metaY = invoiceTitleY;

  // Invoice ID on same line with proper spacing
  const idLabel = "Invoice ID: ";
  const idValue = invoiceData.invoiceId;

  // Measure text widths
  pdf.setFont(SANS, "normal");
  pdf.setFontSize(9);
  const labelWidth = pdf.getTextWidth(idLabel);

  pdf.setFont(SANS, "bold");
  pdf.setFontSize(9);
  const valueWidth = pdf.getTextWidth(idValue);

  // Position to right-align the entire "Invoice ID: INV-XXXXX" line
  const totalLineWidth = labelWidth + valueWidth;
  const startX = pageWidth - margin - totalLineWidth;

  // Draw label in gray
  pdf.setFont(SANS, "normal");
  pdf.setFontSize(9);
  pdf.setTextColor("#71717B");
  pdf.text(idLabel, startX, metaY);

  // Draw value in bold black right after the label
  pdf.setFont(SANS, "bold");
  pdf.setFontSize(9);
  pdf.setTextColor("#000000");
  pdf.text(idValue, startX + labelWidth, metaY);

  metaY += 15;
  addText(
    `Issue Date: ${invoiceData.issueDate || "—"}`,
    pageWidth - margin,
    metaY,
    {
      size: 9,
      color: "#71717B",
      align: "right",
    },
  );
  metaY += 15;
  addText(
    `Due Date: ${invoiceData.dueDate || "—"}`,
    pageWidth - margin,
    metaY,
    {
      size: 9,
      color: "#71717B",
      align: "right",
    },
  );

  // Which month this invoice is for. Recurring invoices raised from the same
  // quote are otherwise identical documents with different numbers, and the
  // client has no way to tell August's from September's.
  const servicePeriod = servicePeriodRange(
    invoiceData.servicePeriodStart,
    invoiceData.servicePeriodEnd,
  );
  if (servicePeriod) {
    metaY += 15;
    addText(
      `Service period: ${servicePeriod}`,
      pageWidth - margin,
      metaY,
      {
        size: 9,
        color: "#71717B",
        align: "right",
      },
    );
  }

  // Provenance, so the client can match the charge to the quote they signed.
  if (invoiceData.sourceQuoteNumber) {
    metaY += 15;
    addText(
      `Raised from quote ${invoiceData.sourceQuoteNumber}`,
      pageWidth - margin,
      metaY,
      {
        size: 9,
        color: "#71717B",
        align: "right",
      },
    );
  }

  yPos = Math.max(invoiceTitleY + 50, metaY + 32);

  // === FROM / BILL TO ===
  const leftCol = margin;
  const rightCol = pageWidth / 2 + 10;

  addText("FROM", leftCol, yPos, {
    size: 8,
    style: "bold",
  });
  addText("BILL TO", rightCol, yPos, {
    size: 8,
    style: "bold",
  });
  yPos += 18;

  // FROM section - use company settings
  let fromY = yPos;
  addText(companyName, leftCol, fromY, {
    size: 10,
    style: "bold",
  });
  
  let billToY = yPos;
  addText(invoiceData.clientName || "—", rightCol, billToY, {
    size: 10,
    style: "bold",
  });
  
  fromY += 14;
  billToY += 14;

  // Company address lines
  const fromAddressLines = (
    companySettings?.companyAddress ||
    "800 S Harvard Blvd\nLos Angeles, CA 90005\nUnited States"
  ).split("\n");
  fromAddressLines.forEach((line) => {
    addText(line.trim(), leftCol, fromY, {
      size: 9,
      color: "#71717B",
    });
    fromY += 14;
  });

  // Company email
  if (companySettings?.companyEmail) {
    addText(companySettings.companyEmail, leftCol, fromY, {
      size: 9,
      color: "#71717B",
    });
    fromY += 14;
  }

  // Company phone
  if (companySettings?.companyPhone) {
    addText(companySettings.companyPhone, leftCol, fromY, {
      size: 9,
      color: "#71717B",
    });
    fromY += 14;
  }

  // BILL TO section - render address
  if (invoiceData.clientAddress) {
    addText(invoiceData.clientAddress, rightCol, billToY, {
      size: 9,
      color: "#71717B",
    });
    billToY += 14;
  }

  // City, State, Zip
  if (
    invoiceData.clientCity ||
    invoiceData.clientState ||
    invoiceData.clientZip
  ) {
    const cityStateZip = `${invoiceData.clientCity}${
      invoiceData.clientCity &&
      (invoiceData.clientState || invoiceData.clientZip)
        ? ", "
        : ""
    }${invoiceData.clientState}${
      invoiceData.clientState && invoiceData.clientZip
        ? " "
        : ""
    }${invoiceData.clientZip}`;
    addText(cityStateZip, rightCol, billToY, {
      size: 9,
      color: "#71717B",
    });
    billToY += 14;
  }

  // Country
  if (invoiceData.clientCountry) {
    addText(invoiceData.clientCountry, rightCol, billToY, {
      size: 9,
      color: "#71717B",
    });
    billToY += 14;
  }

  yPos = Math.max(fromY, billToY) + 10;

  // === DIVIDER LINE ===
  drawLine(margin, yPos, pageWidth - margin, yPos);
  yPos += 18;

  // === LINE ITEMS TABLE ===
  const tableHeaderHeight = 26;
  pdf.setFillColor(0, 0, 0);
  pdf.rect(
    margin,
    yPos,
    pageWidth - 2 * margin,
    tableHeaderHeight,
    "F",
  );

  // Column positions (matching preview: 50%, 16.67%, 16.67%, 16.67%)
  const tableWidth = pageWidth - 2 * margin;
  const col1X = margin + 16;
  const col2X = margin + tableWidth * 0.5;
  const col3X = margin + tableWidth * 0.667;
  const col4X = pageWidth - margin - 16;

  pdf.setTextColor("#FFFFFF");
  addText("ITEM DESCRIPTION", col1X, yPos + 16, {
    size: 8,
    style: "bold",
    color: "#FFFFFF",
  });
  addText("QTY", col2X, yPos + 16, {
    size: 8,
    style: "bold",
    color: "#FFFFFF",
    align: "center",
  });
  addText("UNIT PRICE", col3X, yPos + 16, {
    size: 8,
    style: "bold",
    color: "#FFFFFF",
    align: "right",
  });
  addText("TOTAL", col4X, yPos + 16, {
    size: 8,
    style: "bold",
    color: "#FFFFFF",
    align: "right",
  });

  yPos += tableHeaderHeight;
  pdf.setTextColor("#000000");

  // Table rows
  const rowHeight = 26;
  invoiceData.lineItems.forEach((item, index) => {
    if (index % 2 === 1) {
      pdf.setFillColor(250, 250, 250);
      pdf.rect(
        margin,
        yPos,
        pageWidth - 2 * margin,
        rowHeight,
        "F",
      );
    }

    addText(item.description || "—", col1X, yPos + 16, {
      size: 9,
    });
    addText(item.quantity.toString(), col2X, yPos + 16, {
      size: 9,
      align: "center",
    });
    addText(money(item.unitPrice), col3X, yPos + 16, {
      size: 9,
      align: "right",
    });
    addText(
      money(displayAmount(item)),
      col4X,
      yPos + 16,
      { size: 9, align: "right" },
    );

    yPos += rowHeight;
  });

  yPos += 25;

  const hasRows = invoiceData.lineItems.length > 0;

  // The subtotal has to be the sum of the amounts printed above it, so it is
  // built from the same displayAmount() values rather than recomputed from
  // quantity x price. The passed-in subtotal only stands in for a document
  // with no rows at all.
  const lineSubtotal = hasRows
    ? invoiceData.lineItems.reduce(
        (sum, item) => roundMoney(sum + displayAmount(item)),
        0,
      )
    : subtotal;

  // And the tax and the total have to be the tax and total OF that subtotal.
  // The caller derives both from a subtotal of its own, which is the same
  // number wherever the stored line amounts were respected — the invoice list
  // passes what the server computed. The editor does not: it multiplies
  // quantity by price, so a quote-derived invoice downloaded from there would
  // print "Subtotal 68.69 / Tax 0.00 / Total Due 68.68" and not add up.
  const linePercent = Number(invoiceData.taxPercent) || 0;
  const lineTax = hasRows
    ? roundMoney((lineSubtotal * linePercent) / 100)
    : tax;
  const lineTotal = hasRows ? roundMoney(lineSubtotal + lineTax) : total;

  // === SUMMARY ===
  const summaryWidth = 256;
  const summaryX = pageWidth - margin - summaryWidth;

  addText("Subtotal", summaryX, yPos, {
    size: 9,
    color: "#71717B",
  });
  addText(money(lineSubtotal), pageWidth - margin, yPos, {
    size: 9,
    align: "right",
  });
  yPos += 18;

  addText(`Tax (${invoiceData.taxPercent}%)`, summaryX, yPos, {
    size: 9,
    color: "#71717B",
  });
  addText(money(lineTax), pageWidth - margin, yPos, {
    size: 9,
    align: "right",
  });
  yPos += 20;

  // Divider line
  drawLine(summaryX, yPos, pageWidth - margin, yPos, "#E4E4E7");
  yPos += 20;

  addText("Total Due", summaryX, yPos, {
    size: 14,
    style: "bold",
  });
  addText(
    money(lineTotal),
    pageWidth - margin,
    yPos + 3,
    {
      size: 20,
      style: "bold",
      color: "#006045",
      align: "right",
    },
  );

  yPos += 35;

  // === NOTES ===
  if (invoiceData.notes) {
    yPos += 12;
    drawLine(margin, yPos, pageWidth - margin, yPos, "#E4E4E7");
    yPos += 18;

    const notesLines = pdf.splitTextToSize(
      invoiceData.notes,
      pageWidth - 2 * margin,
    );
    pdf.setFont(SANS, "normal");
    pdf.setFontSize(9);
    pdf.setTextColor("#71717B");
    pdf.text(notesLines, margin, yPos);
    yPos += notesLines.length * 13 + 15;
  }

  // === FOOTER ===
  if (yPos < pageHeight - 90) {
    yPos = pageHeight - 70;
  }
  drawLine(margin, yPos, pageWidth - margin, yPos, "#E4E4E7");
  yPos += 18;
  addText("Thank you for your business.", pageWidth / 2, yPos, {
    size: 9,
    color: "#71717B",
    align: "center",
  });

  return pdf;
}