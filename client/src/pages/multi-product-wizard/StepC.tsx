import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2, Image as ImageIcon, Video } from "lucide-react";
import { toast } from "sonner";
import { type Listing } from "./types";

export function StepC({ listing, onChange }: { listing: Listing; onChange: () => void }) {
  const { data: videos, isLoading: videosLoading } = trpc.videoBank.listVideos.useQuery({
    activeOnly: true,
  });

  const updateMutation = trpc.multiProduct.updateMultiProductListing.useMutation({
    onSuccess: () => {
      onChange();
      toast.success("Mídia atualizada.");
    },
    onError: (e) => toast.error(e.message),
  });

  function handleSelectVideo(videoIdStr: string) {
    if (videoIdStr === "none") {
      updateMutation.mutate({ id: listing.id, videoBankId: null, videoUrl: null });
      return;
    }
    const id = Number(videoIdStr);
    const video = (videos ?? []).find((v: any) => v.id === id);
    if (!video) return;
    updateMutation.mutate({
      id: listing.id,
      videoBankId: id,
      videoUrl: video.url,
    });
  }

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
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span tabIndex={0}>
                        <Button variant="outline" size="sm" disabled>
                          Gerar thumb
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>Disponível na Fase F</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
            </div>
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
            Selecione um vídeo do banco global. Anúncios com vídeo melhoram a Qualidade do Conteúdo na Shopee.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {videosLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando vídeos...
            </div>
          ) : !videos || videos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Banco de vídeos vazio — adicione vídeos em /video-bank (em breve).
            </p>
          ) : (
            <Select
              value={listing.videoBankId !== null ? String(listing.videoBankId) : "none"}
              onValueChange={handleSelectVideo}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um vídeo..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem vídeo</SelectItem>
                {(videos as any[]).map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {listing.videoUrl && (
            <p className="text-xs text-muted-foreground mt-2 truncate">
              URL: {listing.videoUrl}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
