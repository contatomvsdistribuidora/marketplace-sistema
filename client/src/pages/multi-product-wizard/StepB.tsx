import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button variant="outline" size="sm" disabled>
                      Gerar com IA
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Disponível na Fase E</TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button variant="outline" size="sm" disabled>
                      Gerar com IA
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Disponível na Fase E</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
