import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { TITLE_MAX, type Listing } from "./types";

export function StepB({ listing, onChange }: { listing: Listing; onChange: () => void }) {
  const [title, setTitle] = useState(listing.title ?? "");
  const [description, setDescription] = useState(listing.description ?? "");
  const [autoTriggered, setAutoTriggered] = useState(false);

  useEffect(() => {
    setTitle(listing.title ?? "");
    setDescription(listing.description ?? "");
  }, [listing.id, listing.title, listing.description]);

  const updateMutation = trpc.multiProduct.updateMultiProductListing.useMutation({
    onSuccess: () => onChange(),
    onError: (e) => toast.error(e.message),
  });

  const generateTitleMutation = trpc.multiProduct.generateTitleWithAI.useMutation({
    onSuccess: (data) => {
      setTitle(data.title);
      onChange();
      toast.success("Título gerado pela IA.");
    },
    onError: (e) => toast.error(e.message),
  });

  const generateDescMutation = trpc.multiProduct.generateDescriptionWithAI.useMutation({
    onSuccess: (data) => {
      setDescription(data.description);
      onChange();
      toast.success("Descrição gerada pela IA.");
    },
    onError: (e) => toast.error(e.message),
  });

  // Auto-disparar IA UMA vez ao entrar no step se titulo/descricao estao vazios
  useEffect(() => {
    if (autoTriggered) return;
    const titleEmpty = !(listing.title ?? "").trim();
    const descEmpty = !(listing.description ?? "").trim();
    if (!titleEmpty && !descEmpty) { setAutoTriggered(true); return; }
    setAutoTriggered(true);
    if (titleEmpty) generateTitleMutation.mutate({ id: listing.id });
    if (descEmpty) generateDescMutation.mutate({ id: listing.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id]);

  function saveTitle() {
    if (title === (listing.title ?? "")) return;
    updateMutation.mutate({ id: listing.id, title });
  }
  function saveDescription() {
    if (description === (listing.description ?? "")) return;
    updateMutation.mutate({ id: listing.id, description });
  }

  const titleLen = title.length;
  const titleColor =
    titleLen === 0 ? "text-muted-foreground"
    : titleLen >= 70 && titleLen <= TITLE_MAX ? "text-green-600"
    : titleLen > TITLE_MAX ? "text-red-600"
    : "text-yellow-600";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Título do anúncio</CardTitle>
          <CardDescription>Meta: 70–100 caracteres para melhor rankeamento Shopee.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            placeholder="Ex: Kit 5 Sacos de Lixo Reforçados 100L Resistente Hospitalar"
            maxLength={TITLE_MAX + 50}
          />
          <div className="flex items-center justify-between mt-2">
            <span className={`text-xs ${titleColor}`}>
              {titleLen}/{TITLE_MAX} caracteres
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={generateTitleMutation.isPending}
              onClick={() => generateTitleMutation.mutate({ id: listing.id })}
            >
              {generateTitleMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Gerando...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Gerar com IA
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Descrição</CardTitle>
          <CardDescription>
            Descrição completa do anúncio. Inclui benefícios, especificações e diferenciais.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            rows={10}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveDescription}
            placeholder="Escreva a descrição..."
          />
          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-muted-foreground">
              {description.length} caracteres
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={generateDescMutation.isPending}
              onClick={() => generateDescMutation.mutate({ id: listing.id })}
            >
              {generateDescMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Gerando...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Gerar com IA
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
