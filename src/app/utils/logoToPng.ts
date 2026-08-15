import logoPng from "../../assets/logo.svg";

export interface LogoBitmap {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * jsPDF cannot embed an SVG, so the company logo is rasterised to a PNG first.
 *
 * The bitmap is drawn at 4x the size it will occupy in the PDF so it stays crisp
 * when the viewer zooms, while `width`/`height` report the *display* size in
 * points that the caller passes to pdf.addImage().
 *
 * Extracted from InvoiceManagement's inline copy so the quote and invoice PDFs
 * render the same mark at the same size.
 */
export function convertImageToPNG(imgSrc: string): Promise<LogoBitmap> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const maxDisplaySize = 32;
      const resolutionScale = 4;
      let displayWidth = img.width;
      let displayHeight = img.height;

      if (displayWidth > maxDisplaySize || displayHeight > maxDisplaySize) {
        if (displayWidth > displayHeight) {
          displayHeight = (displayHeight / displayWidth) * maxDisplaySize;
          displayWidth = maxDisplaySize;
        } else {
          displayWidth = (displayWidth / displayHeight) * maxDisplaySize;
          displayHeight = maxDisplaySize;
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = displayWidth * resolutionScale;
      canvas.height = displayHeight * resolutionScale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not get a 2D canvas context"));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      // Flatten transparency onto white — the PDF page is white, and an
      // unflattened alpha channel renders as black in some PDF viewers.
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      resolve({
        dataUrl: canvas.toDataURL("image/png", 1.0),
        width: displayWidth,
        height: displayHeight,
      });
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = imgSrc;
  });
}

/**
 * Resolve whatever logo the company has configured into a PNG for jsPDF,
 * falling back to the bundled mark when there is no upload or the fetch fails.
 */
export async function resolveLogoBitmap(settings: {
  logoUrl?: string | null;
  logoPath?: string | null;
}): Promise<LogoBitmap> {
  if (settings.logoUrl && settings.logoPath) {
    let objectUrl: string | null = null;
    try {
      const response = await fetch(settings.logoUrl);
      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);
      return await convertImageToPNG(objectUrl);
    } catch {
      // fall through to the bundled mark
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }
  return convertImageToPNG(logoPng);
}
