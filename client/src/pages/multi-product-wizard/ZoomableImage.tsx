import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

/**
 * Imagem clicável que abre lightbox grande (max 90vw × 90vh).
 *
 * Usado em previews multi-store (Fase 5.1.E) onde o operador precisa ver
 * o detalhe da thumb sem confundir com toggle de seleção. Caller pode
 * passar `disabled` pra desativar a abertura do lightbox (caso a área
 * tenha onClick conflitante).
 */
export function ZoomableImage({
  src,
  alt,
  className,
  wrapperClassName,
  disabled,
}: {
  src: string;
  alt?: string;
  className?: string;
  wrapperClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div
        className={
          (wrapperClassName ?? "") +
          (disabled ? "" : " cursor-zoom-in hover:opacity-90 transition")
        }
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        title={disabled ? undefined : "Clique para ampliar"}
      >
        <img src={src} alt={alt ?? ""} className={className ?? "w-full h-full object-cover"} />
      </div>

      {!disabled && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="!max-w-[90vw] !w-[90vw] !max-h-[90vh] p-2 sm:p-4 flex items-center justify-center">
            <img
              src={src}
              alt={alt ?? ""}
              className="max-w-full max-h-[85vh] object-contain rounded"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
