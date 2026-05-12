import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Star, Store } from "lucide-react";
import { toast } from "sonner";
import { TITLE_MAX, type Listing } from "./types";

export function StepB({ listing, onChange }: { listing: Listing; onChange: () => void }) {
  const [title, setTitle] = useState(listing.title ?? "");
  const [description, setDescription] = useState(listing.description ?? "");

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

  // Auto-trigger removido a pedido do usuario - IA dispara apenas via botao "Gerar com IA"

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

      <PerAccountContentCard listing={listing} />
    </div>
  );
}

/**
 * Multi-store (Fase 4): permite título + descrição por conta Shopee, com
 * geração via IA opcionalmente diferenciada por "tom/foco" pra evitar
 * penalização Shopee por anúncios idênticos entre contas.
 *
 * Inputs vazios = NULL no banco = herda do template global (Cards acima).
 * Movido do StepA pra ficar junto da edição de conteúdo (Fase 4.1).
 */
function PerAccountContentCard({ listing }: { listing: Listing }) {
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
          Personalização por conta
        </CardTitle>
        <CardDescription>
          Cada conta Shopee pode ter título e descrição próprios. Vazio = herda do template acima.
          Shopee penaliza anúncios idênticos entre lojas — varie pelo menos um pouco.
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
                  <ContentSection publication={pub} listing={listing} onSaved={onSaved} />
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
 * Editor de conteúdo (title + description) de uma publication. Vazio = herda
 * do listing template. Botões "IA título"/"IA descrição" aceitam voice hint
 * opcional pra diferenciar versões entre contas.
 */
function ContentSection({
  publication,
  listing,
  onSaved,
}: {
  publication: {
    id: number;
    customTitle: string | null;
    customDescription: string | null;
  };
  listing: Listing;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(publication.customTitle ?? "");
  const [description, setDescription] = useState(publication.customDescription ?? "");
  const [voice, setVoice] = useState("");

  useEffect(() => {
    setTitle(publication.customTitle ?? "");
    setDescription(publication.customDescription ?? "");
  }, [publication.id, publication.customTitle, publication.customDescription]);

  const updateMut = trpc.multiProduct.updatePublicationContent.useMutation({
    onSuccess: () => {
      toast.success("Conteúdo atualizado.");
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const genTitleMut = trpc.multiProduct.generateTitleForPublication.useMutation({
    onSuccess: (data) => {
      setTitle(data.title);
      toast.success("Título gerado pela IA.");
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });
  const genDescMut = trpc.multiProduct.generateDescriptionForPublication.useMutation({
    onSuccess: (data) => {
      setDescription(data.description);
      toast.success("Descrição gerada pela IA.");
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  function save() {
    updateMut.mutate({
      publicationId: publication.id,
      customTitle: title.trim() === "" ? null : title.trim(),
      customDescription: description.trim() === "" ? null : description.trim(),
    });
  }
  function clear() {
    setTitle("");
    setDescription("");
    updateMut.mutate({ publicationId: publication.id, customTitle: null, customDescription: null });
  }

  const titleLen = title.length;
  const titleColor =
    titleLen === 0 ? "text-muted-foreground"
    : titleLen > 120 ? "text-red-600"
    : titleLen >= 70 ? "text-green-600"
    : "text-yellow-600";

  const aiBusy = genTitleMut.isPending || genDescMut.isPending;

  return (
    <div className="px-3 py-3 space-y-2">
      <div>
        <Label htmlFor={`title-${publication.id}`} className="text-[11px] text-muted-foreground">
          Título (até 120 chars)
        </Label>
        <Input
          id={`title-${publication.id}`}
          value={title}
          onChange={(e) => setTitle(e.target.value.slice(0, 120))}
          placeholder={listing.title ?? "(usa título do anúncio)"}
          maxLength={120}
          className="h-8 text-sm"
        />
        <div className="flex items-center justify-between mt-0.5">
          <span className={`text-[10px] ${titleColor}`}>{titleLen}/120</span>
        </div>
      </div>

      <div>
        <Label htmlFor={`desc-${publication.id}`} className="text-[11px] text-muted-foreground">
          Descrição
        </Label>
        <Textarea
          id={`desc-${publication.id}`}
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={listing.description ?? "(usa descrição do anúncio)"}
          className="text-sm"
        />
        <div className="text-[10px] text-muted-foreground mt-0.5">{description.length} caracteres</div>
      </div>

      <div>
        <Label htmlFor={`voice-${publication.id}`} className="text-[11px] text-muted-foreground">
          Tom/foco para IA (opcional)
        </Label>
        <Input
          id={`voice-${publication.id}`}
          value={voice}
          onChange={(e) => setVoice(e.target.value.slice(0, 80))}
          placeholder="ex: tom mais formal, foco em durabilidade"
          maxLength={80}
          className="h-8 text-sm"
        />
        <p className="text-[10px] text-muted-foreground italic mt-0.5">
          Usado pela IA pra diferenciar título/descrição desta conta das outras (evita penalidade Shopee).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 justify-end pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => genTitleMut.mutate({ publicationId: publication.id, voice: voice.trim() || undefined })}
          disabled={aiBusy}
          className="h-7 text-xs"
        >
          {genTitleMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
          IA título
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => genDescMut.mutate({ publicationId: publication.id, voice: voice.trim() || undefined })}
          disabled={aiBusy}
          className="h-7 text-xs"
        >
          {genDescMut.isPending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
          IA descrição
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={updateMut.isPending || (title === "" && description === "")}
          className="h-7 text-xs"
        >
          Limpar (herdar)
        </Button>
        <Button size="sm" onClick={save} disabled={updateMut.isPending} className="h-7 text-xs">
          {updateMut.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
          Salvar conteúdo
        </Button>
      </div>
    </div>
  );
}
