import jsPDF from "jspdf";

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
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
}

interface CompanySettings {
  companyName: string;
  companyAddress: string;
  companyEmail?: string;
  companyPhone?: string;
}

export function generateInvoicePDF(
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

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  let yPos = margin;

  // Helper to add text
  const addText = (
    text: string,
    x: number,
    y: number,
    options?: any,
  ) => {
    pdf.setFont(
      options?.font || "helvetica",
      options?.style || "normal",
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
      color: "#6B6B6B",
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
        color: "#6B6B6B",
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
        color: "#6B6B6B",
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
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  const labelWidth = pdf.getTextWidth(idLabel);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  const valueWidth = pdf.getTextWidth(idValue);

  // Position to right-align the entire "Invoice ID: INV-XXXXX" line
  const totalLineWidth = labelWidth + valueWidth;
  const startX = pageWidth - margin - totalLineWidth;

  // Draw label in gray
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor("#6B6B6B");
  pdf.text(idLabel, startX, metaY);

  // Draw value in bold black right after the label
  pdf.setFont("helvetica", "bold");
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
      color: "#6B6B6B",
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
      color: "#6B6B6B",
      align: "right",
    },
  );

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
      color: "#6B6B6B",
    });
    fromY += 14;
  });

  // Company email
  if (companySettings?.companyEmail) {
    addText(companySettings.companyEmail, leftCol, fromY, {
      size: 9,
      color: "#6B6B6B",
    });
    fromY += 14;
  }

  // Company phone
  if (companySettings?.companyPhone) {
    addText(companySettings.companyPhone, leftCol, fromY, {
      size: 9,
      color: "#6B6B6B",
    });
    fromY += 14;
  }

  // BILL TO section - render address
  if (invoiceData.clientAddress) {
    addText(invoiceData.clientAddress, rightCol, billToY, {
      size: 9,
      color: "#6B6B6B",
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
      color: "#6B6B6B",
    });
    billToY += 14;
  }

  // Country
  if (invoiceData.clientCountry) {
    addText(invoiceData.clientCountry, rightCol, billToY, {
      size: 9,
      color: "#6B6B6B",
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
    addText(`$${item.unitPrice.toFixed(2)}`, col3X, yPos + 16, {
      size: 9,
      align: "right",
    });
    addText(
      `$${(item.quantity * item.unitPrice).toFixed(2)}`,
      col4X,
      yPos + 16,
      { size: 9, align: "right" },
    );

    yPos += rowHeight;
  });

  yPos += 25;

  // === SUMMARY ===
  const summaryWidth = 256;
  const summaryX = pageWidth - margin - summaryWidth;

  addText("Subtotal", summaryX, yPos, {
    size: 9,
    color: "#6B6B6B",
  });
  addText(`$${subtotal.toFixed(2)}`, pageWidth - margin, yPos, {
    size: 9,
    align: "right",
  });
  yPos += 18;

  addText(`Tax (${invoiceData.taxPercent}%)`, summaryX, yPos, {
    size: 9,
    color: "#6B6B6B",
  });
  addText(`$${tax.toFixed(2)}`, pageWidth - margin, yPos, {
    size: 9,
    align: "right",
  });
  yPos += 20;

  // Divider line
  drawLine(summaryX, yPos, pageWidth - margin, yPos, "#E0E0E0");
  yPos += 20;

  addText("Total Due", summaryX, yPos, {
    size: 14,
    style: "bold",
  });
  addText(
    `$${total.toFixed(2)}`,
    pageWidth - margin,
    yPos + 3,
    {
      size: 20,
      style: "bold",
      color: "#22C55E",
      align: "right",
    },
  );

  yPos += 35;

  // === NOTES ===
  if (invoiceData.notes) {
    yPos += 12;
    drawLine(margin, yPos, pageWidth - margin, yPos, "#E0E0E0");
    yPos += 18;

    const notesLines = pdf.splitTextToSize(
      invoiceData.notes,
      pageWidth - 2 * margin,
    );
    pdf.setFont("helvetica", "italic");
    pdf.setFontSize(9);
    pdf.setTextColor("#6B6B6B");
    pdf.text(notesLines, margin, yPos);
    yPos += notesLines.length * 13 + 15;
  }

  // === FOOTER ===
  if (yPos < pageHeight - 90) {
    yPos = pageHeight - 70;
  }
  drawLine(margin, yPos, pageWidth - margin, yPos, "#E0E0E0");
  yPos += 18;
  addText("Thank you for your business.", pageWidth / 2, yPos, {
    size: 9,
    color: "#6B6B6B",
    align: "center",
  });

  return pdf;
}