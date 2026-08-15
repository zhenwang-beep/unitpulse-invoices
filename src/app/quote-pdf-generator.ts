import jsPDF from "jspdf";
import {
  ACCEPTANCE_NOTE,
  AMOUNTS_FOOTNOTE,
  APPROVAL_LINE,
  SCOPE_FOOTNOTE,
  formatMoney,
  formatQuoteDate,
  orDash,
  displayLineAmount,
  displaySubtotal,
  displayMonthly,
  displayDueAtSigning,
  type Quote,
  type QuoteLineItem,
  type ScopeGroup,
} from "./types/quote";

interface CompanySettings {
  companyName: string;
  companyAddress: string;
  companyEmail?: string;
  companyPhone?: string;
}

// --- Design tokens. Never invent a colour. -------------------------------
const TEXT_PRIMARY = "#18181B";
const TEXT_SECONDARY = "#52525C";
const TEXT_MUTED = "#71717B";
const ACCENT = "#006045";
const SURFACE_BRIEF = "#18181B";
const SURFACE_CANVAS = "#FAFAFA";
const SURFACE_SUBTLE = "#F4F4F5";
const BORDER_DEFAULT = "#E4E4E7";
const BORDER_HAIRLINE = "#ECECEE";
const WHITE = "#FFFFFF";

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
};

interface TextOptions {
  size?: number;
  style?: "normal" | "bold" | "italic";
  color?: string;
  align?: "left" | "center" | "right";
  charSpace?: number;
  font?: string;
}

export function generateQuotePDF(
  quote: Quote,
  companySettings?: CompanySettings,
  logoImage?: string,
  logoWidth: number = 32,
  logoHeight: number = 32,
) {
  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "letter",
  });

  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  const contentWidth = pageWidth - 2 * margin; // 516
  const contentRight = pageWidth - margin; // 564

  // The footer owns the bottom of every page; content stops above it.
  const footerRuleY = pageHeight - 54;
  const contentTop = margin;
  const contentBottom = footerRuleY - 24;

  let yPos = contentTop;

  // --- Primitives, mirroring pdf-generator.ts -----------------------------
  const addText = (
    text: string,
    x: number,
    y: number,
    options?: TextOptions,
  ) => {
    pdf.setFont(options?.font || "helvetica", options?.style || "normal");
    pdf.setFontSize(options?.size || 10);
    pdf.setTextColor(options?.color || TEXT_PRIMARY);
    if (options?.charSpace) pdf.setCharSpace(options.charSpace);
    pdf.text(
      text,
      x,
      y,
      options?.align ? { align: options.align } : undefined,
    );
    if (options?.charSpace) pdf.setCharSpace(0);
  };

  const drawLine = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color = BORDER_HAIRLINE,
    width = 0.5,
  ) => {
    pdf.setDrawColor(color);
    pdf.setLineWidth(width);
    pdf.line(x1, y1, x2, y2);
  };

  const fillRect = (
    x: number,
    y: number,
    w: number,
    h: number,
    color: string,
  ) => {
    const [r, g, b] = hexToRgb(color);
    pdf.setFillColor(r, g, b);
    pdf.rect(x, y, w, h, "F");
  };

  /** Eyebrow: Bold, uppercase, letter-spaced, muted by default. */
  const eyebrow = (
    text: string,
    x: number,
    y: number,
    options?: TextOptions,
  ) =>
    addText(text.toUpperCase(), x, y, {
      size: 7.5,
      style: "bold",
      color: TEXT_MUTED,
      charSpace: 1.1,
      ...options,
    });

  /** Wrap on explicit newlines first, then on width. */
  const wrap = (
    text: string,
    width: number,
    size: number,
    style: "normal" | "bold" | "italic" = "normal",
  ): string[] => {
    pdf.setFont("helvetica", style);
    pdf.setFontSize(size);
    return String(text ?? "")
      .split("\n")
      .flatMap((part) => pdf.splitTextToSize(part.trim(), width) as string[]);
  };

  /**
   * Eyebrows are letter-spaced, and splitTextToSize knows nothing about
   * charSpace — it would under-measure and let a long label run out of its
   * column. Measure the spacing ourselves.
   */
  const wrapEyebrow = (
    text: string,
    width: number,
    size = 7.5,
    charSpace = 1.1,
  ): string[] => {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(size);
    const fits = (s: string) => pdf.getTextWidth(s) + charSpace * s.length <= width;
    const words = String(text ?? "")
      .toUpperCase()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    const lines: string[] = [];
    let line = "";
    words.forEach((word) => {
      const next = line ? `${line} ${word}` : word;
      if (line && !fits(next)) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    });
    if (line) lines.push(line);
    return lines;
  };

  // --- Pagination ---------------------------------------------------------
  // ONE gate for every block. Call it with the height of the block you are
  // about to draw; it starts a new page when the block would cross the
  // footer. It never breaks when the cursor is already at the top of a fresh
  // page, so an over-tall block cannot loop forever.
  const newPage = () => {
    pdf.addPage();
    yPos = contentTop;
  };

  const ensureSpace = (needed: number): boolean => {
    if (yPos + needed <= contentBottom) return false;
    if (yPos <= contentTop + 0.5) return false;
    newPage();
    return true;
  };

  /** Tallest block a single page can hold. */
  const pageCapacity = contentBottom - contentTop;

  // --- Bullets ("— " with a hanging indent) -------------------------------
  const bulletLines = (text: string, width: number, size: number) => {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(size);
    const dashW = pdf.getTextWidth("—  ");
    return {
      dashW,
      lines: pdf.splitTextToSize(String(text ?? "").trim(), width - dashW) as string[],
    };
  };

  const bulletHeight = (
    text: string,
    width: number,
    size = 9,
    lineHeight = 12.5,
  ) => bulletLines(text, width, size).lines.length * lineHeight;

  /** Draws one bullet at an absolute y. Does not paginate — callers gate. */
  const drawBullet = (
    text: string,
    x: number,
    y: number,
    width: number,
    size = 9,
    lineHeight = 12.5,
    color = TEXT_SECONDARY,
  ) => {
    const { dashW, lines } = bulletLines(text, width, size);
    addText("—", x, y, { size, color: TEXT_MUTED });
    lines.forEach((line, i) =>
      addText(line, x + dashW, y + i * lineHeight, { size, color }),
    );
    return lines.length * lineHeight;
  };

  const listHeight = (entries: string[], width: number, size = 9, lineHeight = 12.5) =>
    entries.reduce((h, e) => h + bulletHeight(e, width, size, lineHeight) + 5, 0);

  const SECTION_HEADER_H = 52;

  /**
   * A section header must never be the last thing on a page. Callers that
   * open with an atomic block pass its height so the header and that block
   * break together; the cap keeps an over-tall block from demanding more
   * than a page.
   */
  const sectionHeader = (num: string, title: string, firstBlockH = 26) => {
    ensureSpace(
      SECTION_HEADER_H +
        Math.min(firstBlockH, pageCapacity - SECTION_HEADER_H),
    );
    eyebrow(`SECTION ${num}`, margin, yPos);
    yPos += 18;
    addText(title, margin, yPos, { size: 17, color: TEXT_PRIMARY });
    yPos += 12;
    drawLine(margin, yPos, contentRight, yPos, BORDER_DEFAULT, 0.8);
    yPos += 22;
  };

  const items: QuoteLineItem[] = quote.lineItems ?? [];
  const currency = quote.currency || "USD";
  const subtotal = displaySubtotal(quote);
  const setupFee = Number(quote.setupFee) || 0;
  const totalMonthly = displayMonthly(quote);
  const dueAtSigning = displayDueAtSigning(quote);
  const hasSetupFee  = setupFee > 0;
  const companyName = companySettings?.companyName || "UnitPulse";

  // =======================================================================
  // HEADER — wordmark left, SERVICE QUOTE + number right
  // =======================================================================
  // Same simplified wordmark the invoice generator falls back to.
  const drawFallbackMark = () => {
    fillRect(margin, yPos, 32, 32, SURFACE_BRIEF);
    fillRect(margin + 6, yPos + 6, 5, 20, WHITE);
    fillRect(margin + 14, yPos + 6, 12, 13, WHITE);
  };

  let markWidth = 32;
  let markHeight = 32;
  if (logoImage) {
    try {
      pdf.addImage(logoImage, "PNG", margin, yPos, logoWidth, logoHeight);
      markWidth = logoWidth;
      markHeight = logoHeight;
    } catch (e) {
      console.error("Error adding logo to quote PDF:", e);
      drawFallbackMark();
    }
  } else {
    drawFallbackMark();
  }

  addText(companyName, margin + markWidth + 12, yPos + markHeight / 2 + 6, {
    size: 16,
    style: "bold",
    color: TEXT_PRIMARY,
  });

  eyebrow("Service quote", contentRight, yPos + 10, { align: "right" });
  addText(orDash(quote.quoteNumber), contentRight, yPos + 30, {
    size: 14,
    style: "bold",
    color: TEXT_PRIMARY,
    align: "right",
  });

  yPos = Math.max(yPos + markHeight, yPos + 38) + 24;

  // =======================================================================
  // DARK BAND — the ONE dark band in this document
  // =======================================================================
  {
    const padX = 20;
    const padY = 18;
    const innerX = margin + padX;
    const innerW = contentWidth - padX * 2;

    // The band headlines WHO the quote is for, then where they are — matching
    // QuotePreview. Leading with the address (and dropping the name) made the
    // PDF and the on-screen preview state different things.
    const nameLines = wrap(orDash(quote.clientName), innerW, 12.5, "bold");
    const addrLines = quote.preparedForAddress
      ? wrap(quote.preparedForAddress, innerW, 9)
      : [];
    const svcLines = wrap(orDash(quote.serviceLine), innerW, 9);

    // Height is computed with the exact increments the drawing uses below.
    const bandH =
      padY +
      8 +
      16 +
      (nameLines.length - 1) * 15 +
      (addrLines.length ? 14 + (addrLines.length - 1) * 12 : 0) +
      15 +
      (svcLines.length - 1) * 12 +
      15 +
      22 +
      16 +
      6 +
      padY;

    ensureSpace(bandH + 24);
    const bandY = yPos;
    fillRect(margin, bandY, contentWidth, bandH, SURFACE_BRIEF);

    let by = bandY + padY + 8;
    eyebrow("Prepared for", innerX, by, { color: WHITE });

    by += 16;
    nameLines.forEach((line, i) =>
      addText(line, innerX, by + i * 15, {
        size: 12.5,
        style: "bold",
        color: WHITE,
      }),
    );
    by += (nameLines.length - 1) * 15;

    if (addrLines.length) {
      by += 14;
      addrLines.forEach((line, i) =>
        addText(line, innerX, by + i * 12, { size: 9, color: WHITE }),
      );
      by += (addrLines.length - 1) * 12;
    }

    by += 15;
    svcLines.forEach((line, i) =>
      addText(line, innerX, by + i * 12, { size: 9, color: WHITE }),
    );
    by += (svcLines.length - 1) * 12;

    by += 15;
    drawLine(innerX, by, innerX + innerW, by, WHITE, 0.5);

    by += 22;
    const kpis: Array<[string, string, number]> = [
      ["Monthly investment", formatMoney(totalMonthly, currency), 15],
      [
        "Initial term",
        orDash(
          quote.initialTermMonths === null || quote.initialTermMonths === undefined
            ? null
            : `${quote.initialTermMonths} months`,
        ),
        11,
      ],
      ["Service start", formatQuoteDate(quote.serviceStartDate), 11],
    ];
    kpis.forEach(([label, value, size], i) => {
      const x = innerX + (innerW / 3) * i;
      eyebrow(label, x, by, { color: WHITE });
      addText(value, x, by + 16, { size, style: "bold", color: WHITE });
    });

    yPos = bandY + bandH + 28;
  }

  // =======================================================================
  // PARTIES — ISSUED BY / ISSUED TO
  // =======================================================================
  {
    const colGap = 28;
    const colW = (contentWidth - colGap) / 2;
    const leftX = margin;
    const rightX = margin + colW + colGap;

    const contactLine = [quote.clientContactName, quote.clientContactTitle]
      .map((v) => String(v ?? "").trim())
      .filter(Boolean)
      .join(" · ");

    const leftRows: Array<[string, TextOptions]> = [
      [companyName, { size: 10.5, style: "bold", color: TEXT_PRIMARY }],
      [orDash(quote.issuerName), { size: 9.5, color: TEXT_SECONDARY }],
      [orDash(quote.issuerEmail), { size: 9, color: TEXT_MUTED }],
      [orDash(quote.issuerPhone), { size: 9, color: TEXT_MUTED }],
    ];
    const rightRows: Array<[string, TextOptions]> = [
      [orDash(quote.clientName), { size: 10.5, style: "bold", color: TEXT_PRIMARY }],
      [orDash(contactLine), { size: 9.5, color: TEXT_SECONDARY }],
      [orDash(quote.clientEmail), { size: 9, color: TEXT_MUTED }],
      [orDash(quote.clientPhone), { size: 9, color: TEXT_MUTED }],
    ];

    // A client company name or an email longer than the column has to wrap:
    // unwrapped it runs through the facing column and off the right edge of
    // the page.
    const rowLines = ([text, opts]: [string, TextOptions]) =>
      wrap(text, colW, opts.size ?? 10, opts.style ?? "normal");
    const columnHeight = (rows: Array<[string, TextOptions]>) =>
      rows.reduce((h, row) => h + 14 + (rowLines(row).length - 1) * 12, 0);

    const rowsH = Math.max(columnHeight(leftRows), columnHeight(rightRows));
    ensureSpace(18 + rowsH + 34);

    eyebrow("Issued by", leftX, yPos);
    eyebrow("Issued to", rightX, yPos);
    yPos += 18;

    const drawParty = (rows: Array<[string, TextOptions]>, x: number) => {
      let y = yPos;
      rows.forEach((row) => {
        const lines = rowLines(row);
        lines.forEach((line, i) => addText(line, x, y + i * 12, row[1]));
        y += 14 + (lines.length - 1) * 12;
      });
    };
    drawParty(leftRows, leftX);
    drawParty(rightRows, rightX);
    yPos += rowsH + 6;

    drawLine(margin, yPos, contentRight, yPos, BORDER_HAIRLINE);
    yPos += 16;

    // Eyebrow above the value, stacked — matches QuotePreview, and keeps a long
    // date from colliding with the adjacent column.
    const datePair = (label: string, value: string, x: number) => {
      eyebrow(label, x, yPos);
      addText(value, x, yPos + 14, {
        size: 9,
        style: "bold",
        color: TEXT_PRIMARY,
      });
    };
    datePair("Quote date", formatQuoteDate(quote.quoteDate), leftX);
    datePair("Valid until", formatQuoteDate(quote.validUntil), rightX);
    yPos += 46;
  }

  // =======================================================================
  // SECTION 01 — Investment summary
  // =======================================================================
  {
    const colServiceX = margin + 12;
    const colServiceW = 224;
    const colQtyX = margin + 272;
    const colUnitX = margin + 382;
    const colAmountX = contentRight - 12;
    const headerH = 24;

    // The service name wraps inside its column too — a long one would
    // otherwise run straight through QTY and UNIT PRICE.
    const itemLines = (item: QuoteLineItem) => ({
      nameLines: wrap(orDash(item.serviceName), colServiceW, 10, "bold"),
      descLines: wrap(String(item.description ?? "").trim(), colServiceW, 8.5),
    });

    const rowHeightFor = (item: QuoteLineItem) => {
      const { nameLines, descLines } = itemLines(item);
      return Math.max(
        30,
        22 + (nameLines.length - 1) * 12 + descLines.length * 11,
      );
    };

    // The table header bar plus the first row travel with the section header.
    sectionHeader(
      "01",
      "Investment summary",
      headerH + (items.length ? rowHeightFor(items[0]) : 86),
    );

    const drawTableHeader = () => {
      fillRect(margin, yPos, contentWidth, headerH, SURFACE_SUBTLE);
      eyebrow("Service", colServiceX, yPos + 15);
      eyebrow("Qty", colQtyX, yPos + 15, { align: "center" });
      eyebrow("Unit price", colUnitX, yPos + 15, { align: "right" });
      eyebrow("Monthly", colAmountX, yPos + 15, { align: "right" });
      yPos += headerH;
      drawLine(margin, yPos, contentRight, yPos, BORDER_DEFAULT, 0.8);
    };

    drawTableHeader();

    items.forEach((item) => {
      const { nameLines, descLines } = itemLines(item);
      const rowH = rowHeightFor(item);
      // Row-level break: the header is redrawn so a continued table still
      // has column labels.
      if (ensureSpace(rowH)) drawTableHeader();

      nameLines.forEach((line, i) =>
        addText(line, colServiceX, yPos + 16 + i * 12, {
          size: 10,
          style: "bold",
          color: TEXT_PRIMARY,
        }),
      );
      const descTop = yPos + 16 + nameLines.length * 12;
      descLines.forEach((line, i) =>
        addText(line, colServiceX, descTop + i * 11, {
          size: 8.5,
          color: TEXT_MUTED,
        }),
      );
      addText(orDash(item.quantity), colQtyX, yPos + 16, {
        size: 9.5,
        color: TEXT_SECONDARY,
        align: "center",
      });
      addText(formatMoney(item.unitPrice, currency), colUnitX, yPos + 16, {
        size: 9.5,
        color: TEXT_SECONDARY,
        align: "right",
      });
      addText(formatMoney(displayLineAmount(item), currency), colAmountX, yPos + 16, {
        size: 9.5,
        style: "bold",
        color: TEXT_PRIMARY,
        align: "right",
      });

      yPos += rowH;
      drawLine(margin, yPos, contentRight, yPos, BORDER_HAIRLINE);
    });

    // Subtotal / setup fee / total — indivisible, so the accent total never
    // lands on a page without the amounts it sums. The footnote below is
    // allowed to flow on its own; binding it here costs a whole page
    // whenever the total lands near the bottom.
    // + one more 24pt row when a setup fee makes "due at signing" appear.
    const summaryH = 24 + 24 + 38 + (hasSetupFee ? 24 : 0);
    if (ensureSpace(summaryH)) drawTableHeader();

    const summaryRow = (label: string, value: string) => {
      addText(label, colUnitX, yPos + 15, {
        size: 9,
        color: TEXT_MUTED,
        align: "right",
      });
      addText(value, colAmountX, yPos + 15, {
        size: 9.5,
        color: TEXT_PRIMARY,
        align: "right",
      });
      yPos += 24;
      drawLine(margin, yPos, contentRight, yPos, BORDER_HAIRLINE);
    };
    summaryRow("Subtotal", formatMoney(subtotal, currency));
    summaryRow("One-time setup fee", formatMoney(setupFee, currency));

    const totalH = 38;
    fillRect(margin, yPos, contentWidth, totalH, ACCENT);
    eyebrow("Total due monthly", colServiceX, yPos + 23, {
      size: 9,
      color: WHITE,
    });
    addText(formatMoney(totalMonthly, currency), colAmountX, yPos + 25, {
      size: 15,
      style: "bold",
      color: WHITE,
      align: "right",
    });
    yPos += totalH;

    // The preview shows this whenever a one-time fee exists; without it here the
    // PDF and the screen state different amounts for the same quote.
    if (hasSetupFee) {
      addText("Due at signing (first month + setup)", colUnitX, yPos + 16, {
        size: 9,
        style: "bold",
        color: TEXT_SECONDARY,
        align: "right",
      });
      addText(formatMoney(dueAtSigning, currency), colAmountX, yPos + 16, {
        size: 9.5,
        style: "bold",
        color: TEXT_PRIMARY,
        align: "right",
      });
      yPos += 24;
      drawLine(margin, yPos, contentRight, yPos, BORDER_HAIRLINE);
    }
    yPos += 14;

    const footnote = wrap(AMOUNTS_FOOTNOTE, contentWidth, 8);
    ensureSpace(footnote.length * 11 + 12);
    footnote.forEach((line, i) =>
      addText(line, margin, yPos + i * 11, { size: 8, color: TEXT_MUTED }),
    );
    yPos += footnote.length * 11 + 30;
  }

  // =======================================================================
  // SECTION 02 — Scope of services
  // =======================================================================
  {
    const labelW = 156;
    const bulletX = margin + labelW + 12;
    const bulletW = contentRight - bulletX;
    const groups: ScopeGroup[] = quote.scopeGroups ?? [];

    /** Height of a group's left cell — the title plus its category label. */
    const groupLabelHeight = (group: ScopeGroup) => {
      const titles = wrap(orDash(group.title), labelW, 10, "bold").length;
      const cats = wrapEyebrow(group.category, labelW).length;
      return titles * 13 + (cats ? cats * 10 + 4 : 0);
    };

    const firstGroup = groups[0];
    sectionHeader(
      "02",
      "Scope of services",
      firstGroup
        ? Math.max(
            30 +
              (firstGroup.bullets?.[0]
                ? bulletHeight(firstGroup.bullets[0], bulletW)
                : 0),
            groupLabelHeight(firstGroup),
          )
        : 30,
    );

    groups.forEach((group, gi) => {
      const bullets = group.bullets ?? [];
      const firstBulletH = bullets.length
        ? bulletHeight(bullets[0], bulletW)
        : 0;

      const titleLines = wrap(orDash(group.title), labelW, 10, "bold");
      // A long category label wraps inside the label column rather than
      // running into the bullet column.
      const catLines = wrapEyebrow(group.category, labelW);
      const leftH =
        titleLines.length * 13 + (catLines.length ? catLines.length * 10 + 4 : 0);

      // Never orphan a group title: it must be able to carry its first
      // bullet, and the whole label cell has to fit above the footer.
      ensureSpace(Math.max(30 + firstBulletH, leftH));
      const groupTop = yPos;

      titleLines.forEach((line, i) =>
        addText(line, margin, yPos + i * 13, {
          size: 10,
          style: "bold",
          color: TEXT_PRIMARY,
        }),
      );
      catLines.forEach((line, i) =>
        eyebrow(line, margin, yPos + titleLines.length * 13 + 3 + i * 10),
      );

      // Bullets share the group's top baseline so the two cells align.
      let bulletY = groupTop;
      let brokeInside = false;
      bullets.forEach((bullet) => {
        const h = bulletHeight(bullet, bulletW);
        // Bullet-level break: a long scope group flows onto the next page
        // instead of running off the bottom.
        yPos = bulletY;
        if (ensureSpace(h + 10)) {
          bulletY = yPos;
          brokeInside = true;
        }
        drawBullet(bullet, bulletX, bulletY, bulletW);
        bulletY += h + 5;
      });

      // After an internal break the left cell lives on the previous page, so
      // only the bullet column decides where this group ends.
      const blockBottom = brokeInside
        ? bulletY + 3
        : Math.max(groupTop + leftH, bulletY + 3);
      yPos = blockBottom + 12;
      if (gi < groups.length - 1) {
        drawLine(margin, yPos - 6, contentRight, yPos - 6, BORDER_HAIRLINE);
      }
    });

    const approvalH = 14;
    const scopeNote = wrap(SCOPE_FOOTNOTE, contentWidth, 8);
    ensureSpace(approvalH + scopeNote.length * 11 + 30);
    yPos += 6;
    addText(APPROVAL_LINE, margin, yPos, {
      size: 9.5,
      style: "bold",
      color: TEXT_PRIMARY,
    });
    yPos += 16;
    scopeNote.forEach((line, i) =>
      addText(line, margin, yPos + i * 11, { size: 8, color: TEXT_MUTED }),
    );
    yPos += scopeNote.length * 11 + 30;
  }

  // =======================================================================
  // SECTION 03 — Terms & conditions
  // =======================================================================
  {
    const labelW = 150;
    const valueX = margin + labelW + 14;
    const valueW = contentRight - valueX - 12;

    const rows: Array<[string, string]> = [
      ["Service start date", formatQuoteDate(quote.serviceStartDate)],
      [
        "Initial term",
        orDash(
          quote.initialTermMonths === null || quote.initialTermMonths === undefined
            ? null
            : `${quote.initialTermMonths} months from the service start date`,
        ),
      ],
      ["Renewal", orDash(quote.renewalTerms)],
      ["Cancellation", orDash(quote.cancellationTerms)],
      ["Billing cadence", orDash(quote.billingCadence)],
      ["Payment terms", orDash(quote.paymentTerms)],
      ["Price changes", orDash(quote.priceChangeTerms)],
      ["Quote validity", orDash(quote.quoteValidityTerms)],
    ];

    const rowHeightFor = (value: string) =>
      Math.max(30, 18 + wrap(value, valueW, 9).length * 12);

    // Top rule plus the first key/value row travel with the section header.
    sectionHeader("03", "Terms & conditions", 2 + rowHeightFor(rows[0][1]));

    let topRuleDrawn = false;
    const drawTopRule = () => {
      drawLine(margin, yPos, contentRight, yPos, BORDER_DEFAULT, 0.8);
      topRuleDrawn = true;
    };
    drawTopRule();

    rows.forEach(([label, value]) => {
      const valueLines = wrap(value, valueW, 9);
      const rowH = rowHeightFor(value);
      // Row-level break: the key/value table continues on the next page with
      // its own top rule.
      if (ensureSpace(rowH)) {
        topRuleDrawn = false;
      }
      if (!topRuleDrawn) drawTopRule();

      fillRect(margin, yPos, labelW, rowH, SURFACE_CANVAS);
      addText(label, margin + 12, yPos + 19, { size: 9, color: TEXT_MUTED });
      valueLines.forEach((line, i) =>
        addText(line, valueX, yPos + 19 + i * 12, {
          size: 9,
          color: TEXT_SECONDARY,
        }),
      );

      drawLine(
        margin + labelW,
        yPos,
        margin + labelW,
        yPos + rowH,
        BORDER_HAIRLINE,
      );
      yPos += rowH;
      drawLine(margin, yPos, contentRight, yPos, BORDER_HAIRLINE);
    });

    yPos += 30;
  }

  // =======================================================================
  // SECTION 04 — Assumptions & exclusions
  // =======================================================================
  {
    const colGap = 28;
    const colW = (contentWidth - colGap) / 2;
    const leftX = margin;
    const rightX = margin + colW + colGap;
    const included = quote.included ?? [];
    const excluded = quote.excluded ?? [];

    const leftH = 16 + listHeight(included, colW);
    const rightH = 16 + listHeight(excluded, colW);
    const blockH = Math.max(leftH, rightH);

    // The two columns are drawn atomically, so the header has to break with
    // them — otherwise it strands at the bottom of the previous page.
    sectionHeader("04", "Assumptions & exclusions", blockH + 8);

    const drawColumn = (
      x: number,
      startY: number,
      label: string,
      list: string[],
      labelColor: string,
      width: number,
    ) => {
      eyebrow(label, x, startY, { color: labelColor });
      let y = startY + 16;
      if (list.length === 0) {
        drawBullet("—", x, yPos, colW);
      }
      list.forEach((entry) => {
        y += drawBullet(entry, x, y, width) + 5;
      });
      return y;
    };

    // Side by side only when the section header and the whole block can
    // share one page; otherwise the atomic block would break away and
    // strand the header behind it.
    if (blockH + 8 <= pageCapacity - SECTION_HEADER_H) {
      ensureSpace(blockH + 8);
      const startY = yPos;
      const endLeft = drawColumn(
        leftX,
        startY,
        "Included",
        included,
        ACCENT,
        colW,
      );
      const endRight = drawColumn(
        rightX,
        startY,
        "Not included",
        excluded,
        TEXT_MUTED,
        colW,
      );
      yPos = Math.max(endLeft, endRight) + 12;
    } else {
      // Pathologically long lists: stack the columns full width so each
      // bullet can break across pages instead of overflowing.
      const stack = (label: string, list: string[], labelColor: string) => {
        ensureSpace(16 + (list.length ? bulletHeight(list[0], contentWidth) : 0));
        eyebrow(label, margin, yPos, { color: labelColor });
        yPos += 16;
        if (list.length === 0) {
          drawBullet("—", margin, yPos, contentWidth);
          yPos += 17;
        }
        list.forEach((entry) => {
          const h = bulletHeight(entry, contentWidth);
          ensureSpace(h);
          drawBullet(entry, margin, yPos, contentWidth);
          yPos += h + 5;
        });
        yPos += 12;
      };
      stack("Included", included, ACCENT);
      stack("Not included", excluded, TEXT_MUTED);
    }

    if (String(quote.assumptionsNote ?? "").trim()) {
      const noteLines = wrap(quote.assumptionsNote, contentWidth, 8);
      ensureSpace(noteLines.length * 11 + 18);
      yPos += 6;
      noteLines.forEach((line, i) =>
        addText(line, margin, yPos + i * 11, { size: 8, color: TEXT_MUTED }),
      );
      yPos += noteLines.length * 11;
    }
    yPos += 30;
  }

  // =======================================================================
  // SECTION 05 — Acceptance
  // =======================================================================
  {
    const colGap = 28;
    const colW = (contentWidth - colGap) / 2;
    const leftX = margin;
    const rightX = margin + colW + colGap;

    const noteLines = wrap(ACCEPTANCE_NOTE, contentWidth, 9);
    const noteH = noteLines.length * 12 + 26;
    const fields = ["Signature", "Printed name", "Title", "Date"];
    const fieldGap = 34;
    // A signature block is atomic — "FOR THE CLIENT" never splits across a
    // page break, so the header, the note and both blocks are gated as one.
    const blockH = 22 + (fields.length - 1) * fieldGap + 14;

    sectionHeader("05", "Acceptance", noteH + blockH);

    noteLines.forEach((line, i) =>
      addText(line, margin, yPos + i * 12, { size: 9, color: TEXT_SECONDARY }),
    );
    yPos += noteH;
    ensureSpace(blockH);

    const drawSignatureBlock = (x: number, label: string) => {
      eyebrow(label, x, yPos);
      let ry = yPos + 22;
      fields.forEach((field) => {
        drawLine(x, ry, x + colW, ry, BORDER_DEFAULT, 0.8);
        addText(field, x, ry + 11, { size: 7.5, color: TEXT_MUTED });
        ry += fieldGap;
      });
    };
    drawSignatureBlock(leftX, "For the client");
    drawSignatureBlock(rightX, `For ${companyName}`);
    yPos += blockH + 20;
  }

  // =======================================================================
  // NOTES — only when the quote carries them
  // =======================================================================
  if (String(quote.notes ?? "").trim()) {
    const noteLines = wrap(quote.notes, contentWidth, 8.5);
    ensureSpace(noteLines.length * 12 + 32);
    drawLine(margin, yPos, contentRight, yPos, BORDER_HAIRLINE);
    yPos += 18;
    eyebrow("Notes", margin, yPos);
    yPos += 15;
    noteLines.forEach((line, i) =>
      addText(line, margin, yPos + i * 12, { size: 8.5, color: TEXT_SECONDARY }),
    );
    yPos += noteLines.length * 12;
  }

  // =======================================================================
  // FOOTER — drawn last, once the total page count is known
  // =======================================================================
  const totalPages = pdf.getNumberOfPages();
  for (let page = 1; page <= totalPages; page += 1) {
    pdf.setPage(page);
    drawLine(margin, footerRuleY, contentRight, footerRuleY, BORDER_HAIRLINE);
    addText(orDash(quote.quoteNumber), margin, footerRuleY + 16, {
      size: 8,
      color: TEXT_MUTED,
    });
    addText(`Page ${page} of ${totalPages}`, contentRight, footerRuleY + 16, {
      size: 8,
      color: TEXT_MUTED,
      align: "right",
    });
  }
  pdf.setPage(totalPages);

  return pdf;
}
