import { useState, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import ThumbGeneratorModal from "./ThumbGeneratorModal";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Image as ImageIcon, Video, Package, Sparkles, Play, X, Film, Upload, Store, Star, Search } from "lucide-react";
import { toast } from "sonner";
import { type Listing } from "./types";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

type ImageOverrides = {
  primaryImageUrl: string | null;
  excludedImages: string[];
  imageOrder?: string[];
  uploadedImages?: { url: string; uploadedAt: number }[];
};

type ProductImage = {
  productSource: "shopee" | "baselinker";
  productSourceId: number;
  productName: string;
  imageUrl: string;
  isPrimary: boolean;
};

function SortableImage({
  img,
  isPrimary,
  onSetPrimary,
  onExclude,
}: {
  img: ProductImage;
  isPrimary: boolean;
  onSetPrimary: () => void;
  onExclude: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: img.imageUrl });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="relative group border border-gray-200 rounded-lg overflow-hidden bg-gray-50 cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <img
        src={img.imageUrl}
        alt={img.productName}
        className="w-full h-24 object-cover pointer-events-none"
        loading="lazy"
      />
      {isPrimary && (
        <span className="absolute top-1 left-1 text-[10px] bg-orange-500 text-white px-1.5 py-0.5 rounded font-semibold z-10">
          Principal
        </span>
      )}
      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-1 z-20">
        {!isPrimary && (
          <button
            onClick={(e) => { e.stopPropagation(); onSetPrimary(); }}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-[10px] bg-orange-500 hover:bg-orange-600 text-white px-2 py-1 rounded"
            title="Marcar como capa"
          >
            Capa
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onExclude(); }}
          onPointerDown={(e) => e.stopPropagation()}
          className="text-[10px] bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded"
          title="Excluir foto"
        >
          Excluir
        </button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate pointer-events-none">
        {img.productName}
      </div>
    </div>
  );
}

export function StepC({ listing, onChange }: { listing: Listing; onChange: () => void }) {
  const [thumbModalOpen, setThumbModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [importUrlOpen, setImportUrlOpen] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importTitle, setImportTitle] = useState("");
  const [importingUrl, setImportingUrl] = useState(false);
  const thumbFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingThumb, setUploadingThumb] = useState(false);

  const { data: invData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = invData?.inventoryId;

  const imagesQuery = trpc.multiProduct.listProductImages.useQuery(
    { id: listing.id },
    { enabled: !!listing.id },
  );

  const [imageOverrides, setImageOverrides] = useState<ImageOverrides>(() => {
    try {
      const ws = listing.wizardStateJson ? JSON.parse(listing.wizardStateJson) : null;
      return ws?.imageOverrides ?? { primaryImageUrl: null, excludedImages: [], imageOrder: [], uploadedImages: [] };
    } catch {
      return { primaryImageUrl: null, excludedImages: [], imageOrder: [], uploadedImages: [] };
    }
  });

  const [uploadingCount, setUploadingCount] = useState(0);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const imageOverridesMutation = trpc.multiProduct.updateMultiProductListing.useMutation({
    onSuccess: () => onChange(),
    onError: (e) => toast.error(e.message),
  });

  const uploadMutation = trpc.multiProduct.uploadProductImage.useMutation({
    onError: (e) => toast.error("Falha no upload: " + e.message),
  });

  function persistImageOverrides(next: ImageOverrides) {
    setImageOverrides(next);
    let ws: any = {};
    try { ws = listing.wizardStateJson ? JSON.parse(listing.wizardStateJson) : {}; } catch {}
    ws.imageOverrides = next;
    imageOverridesMutation.mutate({ id: listing.id, wizardStateJson: JSON.stringify(ws) });
  }

  function setPrimary(url: string) {
    persistImageOverrides({ ...imageOverrides, primaryImageUrl: url });
    toast.success("Foto marcada como capa");
  }

  function excludeImage(url: string) {
    if (imageOverrides.excludedImages.includes(url)) return;
    persistImageOverrides({
      ...imageOverrides,
      excludedImages: [...imageOverrides.excludedImages, url],
      primaryImageUrl: imageOverrides.primaryImageUrl === url ? null : imageOverrides.primaryImageUrl,
    });
  }

  function restoreImage(url: string) {
    persistImageOverrides({
      ...imageOverrides,
      excludedImages: imageOverrides.excludedImages.filter(u => u !== url),
    });
  }

  function reorderImages(visibleUrlsOrdered: string[]) {
    persistImageOverrides({
      ...imageOverrides,
      imageOrder: visibleUrlsOrdered,
    });
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setUploadingCount(files.length);
    const newUrls: { url: string; uploadedAt: number }[] = [];

    for (const file of files) {
      if (file.size > 5 * 1024 * 1024) {
        toast.error(`${file.name}: maior que 5MB`);
        setUploadingCount(c => c - 1);
        continue;
      }
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        toast.error(`${file.name}: tipo nao aceito (use JPG, PNG ou WEBP)`);
        setUploadingCount(c => c - 1);
        continue;
      }

      try {
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(",")[1] ?? "";
            resolve(base64);
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });

        const result = await uploadMutation.mutateAsync({
          id: listing.id,
          contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
          dataBase64,
        });
        newUrls.push({ url: result.url, uploadedAt: Date.now() });
      } catch (err: any) {
        toast.error(`${file.name}: ${err?.message ?? "erro"}`);
      }
      setUploadingCount(c => c - 1);
    }

    if (newUrls.length > 0) {
      persistImageOverrides({
        ...imageOverrides,
        uploadedImages: [...(imageOverrides.uploadedImages ?? []), ...newUrls],
      });
      toast.success(`${newUrls.length} foto(s) enviada(s)`);
    }

    e.target.value = "";
  }

  function getOrderedVisible(allImages: ProductImage[]): ProductImage[] {
    const uploaded: ProductImage[] = (imageOverrides.uploadedImages ?? []).map(u => ({
      productSource: "shopee" as const,
      productSourceId: 0,
      productName: "Upload do PC",
      imageUrl: u.url,
      isPrimary: false,
    }));
    const combined = [...allImages, ...uploaded];
    const visible = combined.filter(img => !imageOverrides.excludedImages.includes(img.imageUrl));
    if (!imageOverrides.imageOrder || imageOverrides.imageOrder.length === 0) {
      return visible;
    }
    const orderMap = new Map(imageOverrides.imageOrder.map((url, idx) => [url, idx]));
    return [...visible].sort((a, b) => {
      const ia = orderMap.get(a.imageUrl) ?? Infinity;
      const ib = orderMap.get(b.imageUrl) ?? Infinity;
      return ia - ib;
    });
  }

  const { data: videos, isLoading: videosLoading } = trpc.videoBank.listVideos.useQuery({
    activeOnly: true,
  });

  const { data: blVideos, isLoading: blVideosLoading } =
    trpc.videoBank.listBaseLinkerVideos.useQuery(
      { inventoryId: inventoryId ?? 0 },
      { enabled: !!inventoryId },
    );

  const updateMutation = trpc.multiProduct.updateMultiProductListing.useMutation({
    onSuccess: () => {
      onChange();
      toast.success("Mídia atualizada.");
    },
    onError: (e) => toast.error(e.message),
  });

  const requestUploadMut = trpc.videoBank.requestUploadUrl.useMutation();
  const confirmUploadMut = trpc.videoBank.confirmUpload.useMutation();
  const importFromUrlMut = trpc.videoBank.importFromUrl.useMutation();
  const utilsVideoBank = trpc.useUtils();

  const uploadThumbFileMutation = trpc.multiProduct.uploadThumbFile.useMutation({
    onSuccess: () => {
      toast.success("Thumb enviada!");
      onChange();
      setUploadingThumb(false);
    },
    onError: (e) => {
      toast.error(e.message);
      setUploadingThumb(false);
    },
  });

  async function handleUploadThumbFromPC(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem maior que 5MB. Reduza antes de enviar.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Formato inválido. Use JPG, PNG ou WEBP.");
      return;
    }

    setUploadingThumb(true);

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.split(",")[1];
      uploadThumbFileMutation.mutate({
        id: listing.id,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        base64Data,
      });
    };
    reader.onerror = () => {
      toast.error("Erro ao ler arquivo.");
      setUploadingThumb(false);
    };
    reader.readAsDataURL(file);
  }

  function handleSelectVideo(value: string) {
    if (value === "none") {
      updateMutation.mutate({ id: listing.id, videoBankId: null, videoUrl: null });
      return;
    }
    if (value.startsWith("bank:")) {
      const bankId = Number(value.slice(5));
      const v = (videos ?? []).find((x: any) => x.id === bankId);
      if (!v) return;
      updateMutation.mutate({ id: listing.id, videoBankId: bankId, videoUrl: v.url });
      return;
    }
    if (value.startsWith("bl:")) {
      const productId = Number(value.slice(3));
      const v = (blVideos ?? []).find((x: any) => Number(x.productId) === productId);
      if (!v) return;
      // Vídeo do BL: salva só a URL, videoBankId fica null
      updateMutation.mutate({ id: listing.id, videoBankId: null, videoUrl: v.videoUrl });
      return;
    }
  }

  // Shopee exige que init_video_upload receba a duração REAL do arquivo (±tolerância).
  // Sem isso, o processamento server-side da Shopee retorna FAILED. Lemos via
  // <video>.duration de um Object URL temporário. Pode falhar (CORS pra URL externa,
  // metadata indisponível) — chamador deve tratar fallback.
  function getVideoDuration(fileOrUrl: File | string): Promise<number> {
    return new Promise((resolve, reject) => {
      const video = document.createElement("video");
      video.preload = "metadata";
      const cleanup = () => {
        if (fileOrUrl instanceof File) URL.revokeObjectURL(video.src);
      };
      video.onloadedmetadata = () => {
        const d = Math.round(video.duration);
        cleanup();
        if (!Number.isFinite(d) || d <= 0) reject(new Error("Duração inválida"));
        else resolve(d);
      };
      video.onerror = () => {
        cleanup();
        reject(new Error("Não foi possível ler duração do vídeo"));
      };
      video.src = fileOrUrl instanceof File ? URL.createObjectURL(fileOrUrl) : fileOrUrl;
    });
  }

  async function handleUploadVideoFromPC(file: File) {
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      toast.error("Video maior que 30MB. Use um arquivo menor.");
      return;
    }
    const allowed = ["video/mp4", "video/quicktime", "video/webm"];
    if (!allowed.includes(file.type)) {
      toast.error("Formato nao suportado. Use MP4, MOV ou WEBM.");
      return;
    }
    setUploadingVideo(true);
    setUploadProgress(0);
    try {
      // Extrai duração do arquivo local antes de subir — Shopee valida contra
      // a duração real do arquivo no init_video_upload.
      let durationSeconds: number | undefined;
      try {
        durationSeconds = await getVideoDuration(file);
      } catch (e) {
        console.warn("[video] não consegui ler duração local:", e);
      }

      const presigned = await requestUploadMut.mutateAsync({
        contentType: file.type as any,
        sizeBytes: file.size,
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", presigned.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`)));
        xhr.onerror = () => reject(new Error("Falha no upload"));
        xhr.send(file);
      });
      const titleClean = file.name.replace(/\.[^.]+$/, "").slice(0, 256);
      const confirmed = await confirmUploadMut.mutateAsync({
        key: presigned.key,
        title: titleClean,
        durationSeconds,
      });
      handleSelectVideo(`bank:${confirmed.id}`);
      await utilsVideoBank.videoBank.listVideos.invalidate();
      toast.success("Video enviado e salvo no banco!");
      setVideoModalOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha no upload");
    } finally {
      setUploadingVideo(false);
      setUploadProgress(0);
    }
  }

  async function handleImportFromUrl() {
    if (!importUrl.trim() || !importTitle.trim()) {
      toast.error("Preencha URL e titulo.");
      return;
    }
    setImportingUrl(true);
    try {
      // Tenta ler duração da URL antes de mandar importar. CORS frequentemente
      // bloqueia (URL não responde com Access-Control-Allow-Origin), nesse caso
      // mandamos undefined e o backend usa fallback. Não é fatal.
      let durationSeconds: number | undefined;
      try {
        durationSeconds = await getVideoDuration(importUrl.trim());
      } catch (e) {
        console.warn("[video] não consegui ler duração da URL (CORS?):", e);
      }

      const result = await importFromUrlMut.mutateAsync({
        sourceUrl: importUrl.trim(),
        title: importTitle.trim(),
        durationSeconds,
      });
      handleSelectVideo(`bank:${result.id}`);
      await utilsVideoBank.videoBank.listVideos.invalidate();
      toast.success("Video importado e salvo no banco!");
      setImportUrlOpen(false);
      setImportUrl("");
      setImportTitle("");
      setVideoModalOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao importar");
    } finally {
      setImportingUrl(false);
    }
  }

  // Identifica qual fonte está atualmente em uso para calcular o `value` do Select
  const currentBlVideo = listing.videoUrl
    ? (blVideos as any[] | undefined)?.find((v) => v.videoUrl === listing.videoUrl)
    : undefined;
  const currentBankVideo = listing.videoBankId !== null
    ? (videos as any[] | undefined)?.find((v) => v.id === listing.videoBankId)
    : undefined;

  // Lista unificada de videos: BaseLinker + Banco
  const allVideos: Array<{ key: string; value: string; title: string; url: string; source: "bl" | "bank"; subtitle?: string; thumbHint?: string; productName?: string }> = [];
  (blVideos as any[] | undefined ?? []).forEach((v: any) => {
    allVideos.push({
      key: `bl-${v.productId}`,
      value: `bl:${v.productId}`,
      title: v.videoTitle || v.name || `Produto ${v.productId}`,
      url: v.videoUrl,
      source: "bl",
      subtitle: `BaseLinker · #${v.productId}`,
      thumbHint: v.imageUrl,
      productName: v.name,
    });
  });
  (videos as any[] | undefined ?? []).forEach((v: any) => {
    allVideos.push({
      key: `bank-${v.id}`,
      value: `bank:${v.id}`,
      title: v.title,
      url: v.url,
      source: "bank",
      subtitle: v.source === "manual_upload" ? "Upload do PC" : v.source === "external_url" ? "URL importada" : "Banco",
    });
  });

  let currentValue: string;
  if (listing.videoBankId !== null) {
    currentValue = `bank:${listing.videoBankId}`;
  } else if (currentBlVideo) {
    currentValue = `bl:${currentBlVideo.productId}`;
  } else if (listing.videoUrl) {
    // URL personalizada que não bate com nenhuma fonte conhecida
    currentValue = "custom";
  } else {
    currentValue = "none";
  }

  const selectedVideoMeta = allVideos.find(v => v.value === currentValue);

  const isLoading = blVideosLoading || videosLoading;
  const hasAnyVideo = (blVideos?.length ?? 0) > 0 || (videos?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <div className="border border-gray-200 rounded-xl bg-white p-4">
        <div className="flex items-center justify-between mb-3 gap-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            Fotos dos Produtos Vinculados
          </h3>
          <label className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded cursor-pointer flex items-center gap-1.5 shrink-0">
            {uploadingCount > 0 ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Enviando {uploadingCount}...
              </>
            ) : (
              <>+ Adicionar foto do PC</>
            )}
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileSelect}
              className="hidden"
              disabled={uploadingCount > 0}
            />
          </label>
        </div>
        <p className="text-[10px] text-gray-500 mb-3">JPG, PNG ou WEBP. Max 5MB por foto.</p>

        {imagesQuery.isLoading ? (
          <p className="text-xs text-gray-500">Carregando fotos...</p>
        ) : (() => {
          const queryImages: ProductImage[] = imagesQuery.data?.images ?? [];
          const uploadedAsImages: ProductImage[] = (imageOverrides.uploadedImages ?? []).map(u => ({
            productSource: "shopee" as const,
            productSourceId: 0,
            productName: "Upload do PC",
            imageUrl: u.url,
            isPrimary: false,
          }));
          const allImagesForExcl = [...queryImages, ...uploadedAsImages];
          const orderedVisible = getOrderedVisible(queryImages);
          const excludedImages = allImagesForExcl.filter(img => imageOverrides.excludedImages.includes(img.imageUrl));

          if (orderedVisible.length === 0 && excludedImages.length === 0) {
            return <p className="text-xs text-gray-500">Nenhuma foto encontrada nos produtos vinculados.</p>;
          }

          return (
            <>
              {orderedVisible.length === 0 ? (
                <p className="text-xs text-gray-500 italic">Todas as fotos foram excluidas.</p>
              ) : (
                <>
                  {orderedVisible.length > 1 && (
                    <p className="text-[10px] text-gray-500 mb-2">Arraste as fotos para reordenar.</p>
                  )}
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={(ev: DragEndEvent) => {
                      const { active, over } = ev;
                      if (!over || active.id === over.id) return;
                      const oldIndex = orderedVisible.findIndex(img => img.imageUrl === active.id);
                      const newIndex = orderedVisible.findIndex(img => img.imageUrl === over.id);
                      if (oldIndex < 0 || newIndex < 0) return;
                      const newOrder = arrayMove(orderedVisible, oldIndex, newIndex);
                      reorderImages(newOrder.map(i => i.imageUrl));
                    }}
                  >
                    <SortableContext
                      items={orderedVisible.map(i => i.imageUrl)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                        {orderedVisible.map((img) => {
                          const isCustomPrimary = imageOverrides.primaryImageUrl === img.imageUrl;
                          const isAutoPrimary = !imageOverrides.primaryImageUrl && img.isPrimary;
                          const isPrimary = isCustomPrimary || isAutoPrimary;
                          return (
                            <SortableImage
                              key={img.imageUrl}
                              img={img}
                              isPrimary={isPrimary}
                              onSetPrimary={() => setPrimary(img.imageUrl)}
                              onExclude={() => excludeImage(img.imageUrl)}
                            />
                          );
                        })}
                      </div>
                    </SortableContext>
                  </DndContext>
                </>
              )}

              {excludedImages.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h4 className="text-xs font-semibold text-gray-500 mb-2">
                    Fotos excluidas ({excludedImages.length})
                  </h4>
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                    {excludedImages.map((img, idx) => (
                      <div key={idx} className="relative group border border-gray-200 rounded-lg overflow-hidden bg-gray-50 opacity-50">
                        <img
                          src={img.imageUrl}
                          alt={img.productName}
                          className="w-full h-24 object-cover grayscale"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center z-20">
                          <button
                            onClick={() => restoreImage(img.imageUrl)}
                            className="text-[10px] bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded"
                            title="Restaurar foto"
                          >
                            Restaurar
                          </button>
                        </div>
                        <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">
                          {img.productName}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          );
        })()}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            Thumb (imagem de capa)
          </CardTitle>
          <CardDescription>
            Imagem destacada do anúncio. Recomendado: 800×800, fundo branco.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            <div className="h-32 w-32 rounded border bg-muted flex items-center justify-center shrink-0 overflow-hidden">
              {listing.thumbUrl ? (
                <img src={listing.thumbUrl} alt="Thumb" className="h-full w-full object-cover" />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 space-y-2">
              <Badge variant="outline" className="text-xs">
                Status: {listing.thumbStatus}
              </Badge>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setThumbModalOpen(true)}
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  {listing.thumbUrl ? "Regenerar com IA" : "Gerar com IA"}
                </Button>
                <input
                  ref={thumbFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadThumbFromPC(f);
                    e.target.value = "";
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploadingThumb}
                  onClick={() => thumbFileInputRef.current?.click()}
                >
                  {uploadingThumb ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</>
                  ) : (
                    <><Upload className="h-4 w-4 mr-2" /> Enviar do computador</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <ThumbGeneratorModal
        listingId={listing.id}
        isOpen={thumbModalOpen}
        onClose={() => setThumbModalOpen(false)}
        onThumbGenerated={() => {
          onChange();
          toast.success("Thumb salva com sucesso!");
        }}
        initialThumbUrl={listing.thumbUrl}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Video className="h-4 w-4" />
            Vídeo
          </CardTitle>
          <CardDescription>
            Selecione um vídeo cadastrado no BaseLinker (extra_field "Vídeo arquivo")
            ou do banco interno. Anúncios com vídeo melhoram a Qualidade do Conteúdo na Shopee.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando vídeos...
            </div>
          ) : !hasAnyVideo ? (
            <p className="text-sm text-muted-foreground">
              Nenhum vídeo disponível. Cadastre vídeos nos produtos do BaseLinker
              (campo extra "Vídeo arquivo") ou adicione manualmente em /video-bank (em breve).
            </p>
          ) : (
            <div className="space-y-3">
              {/* Preview do video selecionado + botao trocar */}
              {selectedVideoMeta || listing.videoUrl ? (
                <div className="rounded-xl border bg-muted/30 p-3 flex items-center gap-3">
                  <div className="relative h-20 w-32 rounded overflow-hidden bg-black flex-shrink-0">
                    <video
                      src={selectedVideoMeta?.url || listing.videoUrl || ""}
                      className="h-full w-full object-cover"
                      preload="metadata"
                      muted
                    />
                    <button
                      type="button"
                      onClick={() => setVideoPreviewUrl(selectedVideoMeta?.url || listing.videoUrl || null)}
                      className="absolute inset-0 flex items-center justify-center bg-black/30 hover:bg-black/50 transition"
                    >
                      <Play className="h-6 w-6 text-white fill-white" />
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm line-clamp-1">
                      {selectedVideoMeta?.title ?? "Video personalizado"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {selectedVideoMeta?.subtitle ?? listing.videoUrl}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="outline" onClick={() => setVideoModalOpen(true)}>
                      Trocar
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handleSelectVideo("none")}>
                      Remover
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setVideoModalOpen(true)}
                  className="w-full h-20 border-dashed"
                >
                  <Film className="h-5 w-5 mr-2" />
                  Selecionar video ({allVideos.length} disponiveis)
                </Button>
              )}
            </div>
          )}

          {/* Modal Galeria de Videos — modo listing (template global) */}
          <VideoPickerDialog
            isOpen={videoModalOpen}
            onClose={() => setVideoModalOpen(false)}
            mode="listing"
            currentValue={currentValue}
            allVideos={allVideos}
            onSelect={(v) => { handleSelectVideo(v); setVideoModalOpen(false); }}
            onPreview={setVideoPreviewUrl}
            onUploadFile={handleUploadVideoFromPC}
            onImportFromUrl={() => setImportUrlOpen(true)}
            uploadingVideo={uploadingVideo}
            uploadProgress={uploadProgress}
          />

          {/* Modal Importar URL */}
          <Dialog open={importUrlOpen} onOpenChange={(o) => { if (!importingUrl) setImportUrlOpen(o); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Importar video de URL</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium">URL do video (link direto .mp4)</label>
                  <Input
                    placeholder="https://exemplo.com/video.mp4"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    disabled={importingUrl}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Nao funciona com YouTube, TikTok, Instagram, Facebook ou Vimeo.
                    Use Google Drive publico, Dropbox ou link direto.
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium">Titulo do video</label>
                  <Input
                    placeholder="Ex: Demo do produto X"
                    value={importTitle}
                    onChange={(e) => setImportTitle(e.target.value)}
                    disabled={importingUrl}
                    maxLength={256}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setImportUrlOpen(false)} disabled={importingUrl}>
                  Cancelar
                </Button>
                <Button onClick={handleImportFromUrl} disabled={importingUrl}>
                  {importingUrl ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Importando...</> : "Importar"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Player Preview Flutuante */}
          <Dialog open={!!videoPreviewUrl} onOpenChange={(o) => !o && setVideoPreviewUrl(null)}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Pre-visualizacao</DialogTitle>
              </DialogHeader>
              {videoPreviewUrl && (
                <video
                  src={videoPreviewUrl}
                  controls
                  autoPlay
                  className="w-full rounded"
                  style={{ maxHeight: "70vh" }}
                />
              )}
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      <PerAccountMediaCard listing={listing} allVideos={allVideos} />
    </div>
  );
}

type AllVideosList = Array<{
  key: string;
  value: string;
  title: string;
  url: string;
  source: "bl" | "bank";
  subtitle?: string;
  thumbHint?: string;
  productName?: string;
}>;

/**
 * Multi-store (Fase 5): permite thumb + vídeo por conta Shopee.
 *
 * Thumb: upload manual, geração IA com voice hint (reusa params do listing-pai
 * via skipListingUpdate), ou herda do listing (NULL).
 * Vídeo: dropdown unificado (videoBank + BL videos) ou herda. Sem upload novo
 * per-conta — quem precisa sobe pelo template global acima.
 *
 * Custom URL/ID = NULL no banco = herda do listing.
 */
function PerAccountMediaCard({
  listing,
  allVideos,
}: {
  listing: Listing;
  allVideos: AllVideosList;
}) {
  const accountsQuery = trpc.shopee.listActiveAccounts.useQuery();
  const publicationsQuery = trpc.multiProduct.listPublications.useQuery(
    { listingId: listing.id },
  );
  const utils = trpc.useUtils();

  const accounts = accountsQuery.data ?? [];
  const publications = publicationsQuery.data ?? [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const onSaved = () => utils.multiProduct.listPublications.invalidate({ listingId: listing.id });
  const isLoading = accountsQuery.isLoading || publicationsQuery.isLoading;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Store className="h-4 w-4 text-muted-foreground" />
          Mídia por conta
        </CardTitle>
        <CardDescription>
          Cada conta Shopee pode ter thumb e vídeo próprios. Vazio = herda do template acima.
          Shopee penaliza thumbs idênticas entre lojas — varie pelo menos um pouco.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : publications.length === 0 ? (
          <div className="text-xs text-muted-foreground italic">
            Nenhuma conta marcada. Volte ao Step 1 e selecione as contas onde publicar.
          </div>
        ) : (
          <div className="space-y-3">
            {publications.map((pub) => {
              const acc = accountById.get(pub.shopeeAccountId);
              const isPrincipal = pub.shopeeAccountId === listing.shopeeAccountId;
              return (
                <div key={pub.id} className="rounded border border-gray-200 bg-gray-50/50">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-white rounded-t">
                    <Store className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      {acc?.shopName ?? `Conta #${acc?.shopId ?? pub.shopeeAccountId}`}
                    </span>
                    {acc?.shopId && (
                      <span className="text-xs text-muted-foreground">#{acc.shopId}</span>
                    )}
                    {isPrincipal && (
                      <Badge variant="outline" className="text-[10px] gap-1 border-yellow-300 bg-yellow-50 text-yellow-700">
                        <Star className="h-3 w-3 fill-yellow-400" />
                        principal
                      </Badge>
                    )}
                  </div>
                  <MediaSection publication={pub} listing={listing} allVideos={allVideos} onSaved={onSaved} />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Editor de thumb + vídeo de uma publication. Save automático em cada ação
 * (upload, IA, troca de dropdown). Inputs vazios não existem — limpar é
 * botão explícito que envia NULL e volta a herdar do listing.
 */
function MediaSection({
  publication,
  listing,
  allVideos,
  onSaved,
}: {
  publication: {
    id: number;
    customThumbUrl: string | null;
    customVideoId: number | null;
  };
  listing: Listing;
  allVideos: AllVideosList;
  onSaved: () => void;
}) {
  const [voice, setVoice] = useState("");
  const [videoPickerOpen, setVideoPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const effectiveThumbUrl = publication.customThumbUrl ?? listing.thumbUrl;
  const isHerdadoThumb = publication.customThumbUrl == null;

  const currentVideoValue = publication.customVideoId != null
    ? `bank:${publication.customVideoId}`
    : "none";
  const currentVideoMeta = publication.customVideoId != null
    ? allVideos.find((v) => v.value === currentVideoValue)
    : null;
  // Aviso: listing pode usar vídeo BL (videoUrl puro sem videoBankId).
  // Override per-conta só suporta videoBank — listing BL videos exigem subir
  // no banco primeiro pra serem variáveis.
  const listingHasBlVideo = !!listing.videoUrl && listing.videoBankId == null;

  const updateMut = trpc.multiProduct.updatePublicationMedia.useMutation({
    onSuccess: () => { toast.success("Mídia atualizada."); onSaved(); },
    onError: (e) => toast.error(e.message),
  });
  const uploadMut = trpc.multiProduct.uploadThumbForPublication.useMutation({
    onSuccess: () => { toast.success("Thumb enviada."); onSaved(); },
    onError: (e) => toast.error(e.message),
  });
  const genThumbMut = trpc.multiProduct.generateThumbForPublication.useMutation({
    onSuccess: () => { toast.success("Thumb gerada pela IA."); onSaved(); },
    onError: (e) => toast.error(e.message),
  });

  async function handleUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Imagem maior que 5MB.");
      return;
    }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Use JPG, PNG ou WEBP.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64Data = dataUrl.split(",")[1];
      uploadMut.mutate({
        publicationId: publication.id,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        base64Data,
      });
    };
    reader.onerror = () => toast.error("Erro ao ler arquivo.");
    reader.readAsDataURL(file);
  }

  function changeVideo(value: string) {
    if (value === "none") {
      updateMut.mutate({
        publicationId: publication.id,
        customThumbUrl: publication.customThumbUrl,
        customVideoId: null,
      });
      return;
    }
    if (value.startsWith("bank:")) {
      const bankId = Number(value.slice(5));
      updateMut.mutate({
        publicationId: publication.id,
        customThumbUrl: publication.customThumbUrl,
        customVideoId: bankId,
      });
    }
  }

  function clearThumb() {
    updateMut.mutate({
      publicationId: publication.id,
      customThumbUrl: null,
      customVideoId: publication.customVideoId,
    });
  }

  const busy = updateMut.isPending || uploadMut.isPending || genThumbMut.isPending;

  return (
    <div className="px-3 py-3 space-y-3">
      {/* THUMB */}
      <div>
        <Label className="text-[11px] text-muted-foreground">Thumb</Label>
        <div className="flex items-start gap-3 mt-1">
          <div className="relative w-24 h-24 rounded border border-gray-200 bg-white overflow-hidden flex-shrink-0">
            {effectiveThumbUrl ? (
              <img src={effectiveThumbUrl} alt="thumb" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground">sem thumb</div>
            )}
            {isHerdadoThumb && effectiveThumbUrl && (
              <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] text-center py-0.5">
                herdado
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <Button
              variant="outline" size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="h-7 text-xs justify-start"
            >
              <Upload className="h-3 w-3 mr-1" />
              {uploadMut.isPending ? "Enviando..." : "Trocar (upload)"}
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={() => genThumbMut.mutate({ publicationId: publication.id, voice: voice.trim() || undefined })}
              disabled={busy}
              className="h-7 text-xs justify-start"
            >
              {genThumbMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
              Variar com IA
            </Button>
            <Button
              variant="ghost" size="sm"
              onClick={clearThumb}
              disabled={busy || isHerdadoThumb}
              className="h-7 text-xs justify-start"
            >
              Limpar (herdar)
            </Button>
          </div>
        </div>
      </div>

      <div>
        <Label htmlFor={`voice-thumb-${publication.id}`} className="text-[11px] text-muted-foreground">
          Tom/foco visual para IA (opcional)
        </Label>
        <Input
          id={`voice-thumb-${publication.id}`}
          value={voice}
          onChange={(e) => setVoice(e.target.value.slice(0, 80))}
          placeholder="ex: cor azul de destaque, vibe minimalista"
          maxLength={80}
          className="h-8 text-sm"
        />
      </div>

      {/* VÍDEO */}
      <div>
        <Label className="text-[11px] text-muted-foreground">Vídeo</Label>
        <div className="flex items-center gap-2 mt-0.5">
          <Select value={currentVideoValue} onValueChange={changeVideo} disabled={busy}>
            <SelectTrigger className="h-8 text-sm flex-1">
              <SelectValue placeholder="herda do anúncio" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {listing.videoBankId || listing.videoUrl ? "Herda do anúncio" : "Sem vídeo"}
              </SelectItem>
              {allVideos
                .filter((v) => v.source === "bank")
                .map((v) => (
                  <SelectItem key={v.key} value={v.value}>
                    {v.title}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setVideoPickerOpen(true)}
            disabled={busy}
            className="h-8 text-xs gap-1 flex-shrink-0"
            title="Abre painel completo com preview, busca e cards"
          >
            <Film className="h-3.5 w-3.5" />
            Painel completo
          </Button>
        </div>
        {listingHasBlVideo && publication.customVideoId == null && (
          <p className="text-[10px] text-orange-700 italic mt-1">
            Anúncio usa vídeo BaseLinker — pra variar por conta, suba ao banco no template acima.
          </p>
        )}
        {currentVideoMeta && (
          <p className="text-[10px] text-muted-foreground mt-1">Selecionado: {currentVideoMeta.title}</p>
        )}
      </div>

      <VideoPickerDialog
        isOpen={videoPickerOpen}
        onClose={() => setVideoPickerOpen(false)}
        mode="publication"
        currentValue={currentVideoValue}
        allVideos={allVideos}
        onSelect={(v) => { changeVideo(v); setVideoPickerOpen(false); }}
      />
    </div>
  );
}

/**
 * Dialog reutilizado pra seleção de vídeo. Suporta 2 modos:
 *  - "listing" (default): mostra TODOS os vídeos (bank + BL) + footer com
 *    botões Upload PC / Importar URL. Usado pelo Step 4 template global.
 *  - "publication": mostra APENAS bank videos, sem footer de upload —
 *    publication só seleciona, não cria. Quem quer subir novo usa o template.
 */
function VideoPickerDialog({
  isOpen,
  onClose,
  mode = "listing",
  currentValue,
  allVideos,
  onSelect,
  onPreview,
  onUploadFile,
  onImportFromUrl,
  uploadingVideo,
  uploadProgress,
}: {
  isOpen: boolean;
  onClose: () => void;
  mode?: "listing" | "publication";
  currentValue: string;
  allVideos: AllVideosList;
  onSelect: (value: string) => void;
  onPreview?: (url: string) => void;
  onUploadFile?: (file: File) => void;
  onImportFromUrl?: () => void;
  uploadingVideo?: boolean;
  uploadProgress?: number;
}) {
  const [search, setSearch] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const visibleVideos = mode === "publication"
    ? allVideos.filter((v) => v.source === "bank")
    : allVideos;
  const filtered = search.trim()
    ? visibleVideos.filter((v) => v.title.toLowerCase().includes(search.toLowerCase()))
    : visibleVideos;

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-[98vw] w-[98vw] !h-[95vh] flex flex-col p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>
            {mode === "publication" ? "Selecione um vídeo para esta conta" : "Selecione um vídeo"}
          </DialogTitle>
        </DialogHeader>

        {mode === "publication" && (
          <div className="text-xs text-muted-foreground italic mb-2">
            Apenas vídeos do banco. Pra subir novo, use o template global do Step 4.
          </div>
        )}

        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Badge variant="outline">{filtered.length} vídeo(s)</Badge>
        </div>

        <div className="overflow-y-auto flex-1 -mx-2 px-2">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Film className="h-12 w-12 mb-3 opacity-30" />
              <p className="text-sm">Nenhum vídeo encontrado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
              {filtered.map((v) => {
                const isSelected = v.value === currentValue;
                return (
                  <div
                    key={v.key}
                    className={`relative rounded-lg border-2 overflow-hidden transition cursor-pointer ${
                      isSelected ? "border-primary ring-2 ring-primary/20" : "border-transparent hover:border-muted-foreground/30"
                    }`}
                    onClick={() => onSelect(v.value)}
                  >
                    <div className="relative aspect-video bg-black">
                      <video src={v.url} className="h-full w-full object-cover" preload="metadata" muted />
                      {onPreview && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onPreview(v.url); }}
                          className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/50 transition opacity-0 hover:opacity-100"
                        >
                          <Play className="h-10 w-10 text-white fill-white" />
                        </button>
                      )}
                      {isSelected && (
                        <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                          <Film className="h-3 w-3" />
                        </div>
                      )}
                    </div>
                    <div className="p-3 bg-card space-y-1">
                      <div className="text-sm font-semibold line-clamp-2">{v.title}</div>
                      {v.productName && (
                        <div className="text-xs text-muted-foreground line-clamp-1">📦 {v.productName}</div>
                      )}
                      <Badge variant="secondary" className="text-[10px]">{v.subtitle}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer com upload + import só no modo listing */}
        {mode === "listing" && (
          <div className="border-t pt-3 mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && onUploadFile) onUploadFile(f);
                if (fileRef.current) fileRef.current.value = "";
              }}
            />
            <Button
              type="button"
              variant="default"
              onClick={() => fileRef.current?.click()}
              disabled={uploadingVideo}
              className="gap-2"
            >
              {uploadingVideo ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Enviando {uploadProgress ?? 0}%</>
              ) : (
                <><ImageIcon className="h-4 w-4" /> Enviar do PC</>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onImportFromUrl}
              disabled={uploadingVideo}
              className="gap-2"
            >
              <Search className="h-4 w-4" /> Importar de URL
            </Button>
            <span className="text-xs text-muted-foreground ml-auto">
              Max 30MB · MP4/MOV/WEBM · fica salvo pra reusar
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
