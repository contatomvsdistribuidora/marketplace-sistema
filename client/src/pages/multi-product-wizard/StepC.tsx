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

export function StepC({ listing, onChange }: { listing: Listing; onChange: () => void }) {
  const [extraPrompt, setExtraPrompt] = useState("");

  const { data: invData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = invData?.inventoryId;

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
