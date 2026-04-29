import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Image as ImageIcon, Video, Package, Sparkles } from "lucide-react";
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
  const [extraPrompt, setExtraPrompt] = useState("");

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

  const generateThumbMutation = trpc.multiProduct.generateThumbWithAI.useMutation({
    onSuccess: () => {
      onChange();
      toast.success("Thumb gerada com sucesso.");
    },
    onError: (e) => toast.error(e.message),
  });

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

  // Identifica qual fonte está atualmente em uso para calcular o `value` do Select
  const currentBlVideo = listing.videoUrl
    ? (blVideos as any[] | undefined)?.find((v) => v.videoUrl === listing.videoUrl)
    : undefined;
  const currentBankVideo = listing.videoBankId !== null
    ? (videos as any[] | undefined)?.find((v) => v.id === listing.videoBankId)
    : undefined;

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
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={generateThumbMutation.isPending}
                  onClick={() =>
                    generateThumbMutation.mutate({
                      id: listing.id,
                      extraPrompt: extraPrompt.trim() || undefined,
                    })
                  }
                >
                  {generateThumbMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Gerando...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      {listing.thumbUrl ? "Regenerar thumb" : "Gerar thumb"}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
          <div className="mt-3 space-y-1">
            <Label htmlFor="extra-prompt" className="text-xs text-muted-foreground">
              Instruções extras (opcional)
            </Label>
            <Textarea
              id="extra-prompt"
              rows={2}
              value={extraPrompt}
              onChange={(e) => setExtraPrompt(e.target.value)}
              placeholder='Ex: "use fundo amarelo", "destaque a palavra KIT"'
              className="text-xs"
              disabled={generateThumbMutation.isPending}
            />
          </div>
        </CardContent>
      </Card>

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
            <Select value={currentValue} onValueChange={handleSelectVideo}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione um vídeo..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem vídeo</SelectItem>
                {currentValue === "custom" && (
                  <SelectItem value="custom" disabled>URL personalizada (atual)</SelectItem>
                )}
                {blVideos && blVideos.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-xs">
                      Vídeos do BaseLinker ({blVideos.length})
                    </SelectLabel>
                    {(blVideos as any[]).map((v) => (
                      <SelectItem key={`bl:${v.productId}`} value={`bl:${v.productId}`}>
                        {v.videoTitle ?? v.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {videos && videos.length > 0 && (
                  <SelectGroup>
                    <SelectLabel className="text-xs">Banco de vídeos</SelectLabel>
                    {(videos as any[]).map((v) => (
                      <SelectItem key={`bank:${v.id}`} value={`bank:${v.id}`}>
                        {v.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          )}

          {/* Preview do vídeo selecionado */}
          {listing.videoUrl && (
            <div className="rounded border bg-muted/30 p-3 text-xs space-y-1">
              {currentBlVideo ? (
                <div className="flex items-start gap-2">
                  {currentBlVideo.imageUrl ? (
                    <img
                      src={currentBlVideo.imageUrl}
                      alt=""
                      className="h-10 w-10 rounded object-cover border shrink-0"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-10 w-10 rounded bg-muted flex items-center justify-center shrink-0">
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium line-clamp-1">
                      {currentBlVideo.videoTitle ?? currentBlVideo.name}
                    </div>
                    <div className="text-muted-foreground">
                      Produto BaseLinker · ID {String(currentBlVideo.productId)}
                    </div>
                  </div>
                </div>
              ) : currentBankVideo ? (
                <div>
                  <div className="font-medium">{currentBankVideo.title}</div>
                  <div className="text-muted-foreground truncate">{currentBankVideo.url}</div>
                </div>
              ) : (
                <div>
                  <div className="font-medium">URL personalizada</div>
                  <div className="text-muted-foreground truncate">{listing.videoUrl}</div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
