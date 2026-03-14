import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Store, Loader2 } from "lucide-react";

const marketplaceIcons: Record<string, string> = {
  mercadolivre: "🟡",
  shopee: "🟠",
  amazon: "📦",
  tiktok: "🎵",
  madeiramadeira: "🪵",
  leroymerlin: "🏠",
  magalu: "🔵",
  americanas: "🔴",
  casasbahia: "🏪",
  carrefour: "🛒",
  aliexpress: "🌏",
  shein: "👗",
  kabum: "⚡",
  dafiti: "👟",
  netshoes: "🏃",
  centauro: "🏅",
  fastshop: "💻",
  rihappy: "🧸",
  olxbr: "📱",
  privalia: "🛍️",
  renner: "👔",
  riachuelo: "👕",
  zattini: "👠",
  zoom: "🔍",
  webcontinental: "🏬",
  olist: "📊",
  belezanaweb: "💄",
  decathlonbr: "⚽",
  polishop: "📺",
  temu: "🎁",
};

export default function MarketplacesPage() {
  const { data: marketplaces, isLoading } = trpc.marketplaces.list.useQuery();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Marketplaces</h1>
        <p className="text-muted-foreground mt-1">
          Marketplaces disponíveis para exportação de produtos
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Carregando marketplaces...
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {(marketplaces || []).map((mp: any) => (
            <Card key={mp.id} className="hover:shadow-md transition-shadow">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-xl shrink-0">
                  {marketplaceIcons[mp.code] || <Store className="h-5 w-5 text-muted-foreground" />}
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{mp.name}</p>
                  <p className="text-xs text-muted-foreground font-mono">{mp.code}</p>
                </div>
                <Badge variant="outline" className="ml-auto shrink-0 text-xs">
                  Ativo
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="bg-muted/30">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Nota:</strong> Estes são os marketplaces suportados pelo BaseLinker no Brasil. 
            Para que a exportação funcione, o marketplace precisa estar conectado na sua conta do BaseLinker. 
            Acesse BaseLinker → Integrações para configurar as conexões.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
