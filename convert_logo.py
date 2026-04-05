import fitz

def convert_pdf_to_png(pdf_path, output_png_path, dpi=300):
    try:
        doc = fitz.open(pdf_path)
        page = doc.load_page(0)
        # Create a matrix for higher resolution rendering
        zoom = dpi / 72.0
        mat = fitz.Matrix(zoom, zoom)
        
        # We try to use transparent background if possible. alpha=True handles CMYK/RGB with alpha
        pix = page.get_pixmap(matrix=mat, alpha=True)
        pix.save(output_png_path)
        
        print(f"Successfully converted {pdf_path} to {output_png_path}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    convert_pdf_to_png("Logo HEC.pdf", "Logo_HEC.png", dpi=600)
