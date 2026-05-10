import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { DEFAULT_FREIGHT_TABLE, DEFAULT_SUBSIDY_TABLE, type FreightTier, type SubsidyTier } from "@shared/freight-calc";

export default function ShopeeFrete() {
  const utils = trpc.useUtils();

  const { data: freightTableData } = trpc.settings.getFreightTable.useQuery();
  const { data: subsidyTableData } = trpc.settings.getSubsidyTable.useQuery();
  const [freightTable, setFreightTable] = useState<FreightTier[]>(DEFAULT_FREIGHT_TABLE);
  const [subsidyTable, setSubsidyTable] = useState<SubsidyTier[]>(DEFAULT_SUBSIDY_TABLE);
  const setFreightTableMutation = trpc.settings.setFreightTable.useMutation({
    onSuccess: () => {
      toast.success("Tabela de frete salva!");
      utils.settings.getFreightTable.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  const setSubsidyTableMutation = trpc.settings.setSubsidyTable.useMutation({
    onSuccess: () => {
      toast.success("Tabela de subsídio salva!");
      utils.settings.getSubsidyTable.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });
  useEffect(() => { if (freightTableData) setFreightTable(freightTableData); }, [freightTableData]);
  useEffect(() => { if (subsidyTableData) setSubsidyTable(subsidyTableData); }, [subsidyTableData]);

  return (
    <div className="w-full max-w-screen-2xl mx-auto p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold mb-1">Frete Shopee</h1>
        <p className="text-sm text-muted-foreground">
          Tabelas usadas pra calcular o custo real de frete no cálculo de margem dos anúncios combinados.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Tabela de Frete Real (Shopee)</CardTitle>
              <CardDescription>
                Custo estimado da transportadora Shopee Xpress por peso cobrável (max entre peso real e (L×W×H)/6000).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground">
              <div className="col-span-5">Peso até (kg)</div>
              <div className="col-span-5">Custo (R$)</div>
              <div className="col-span-2"></div>
            </div>
            {freightTable.map((tier, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-5"
                  type="number" step="0.01" min="0.01"
                  value={tier.maxWeight}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setFreightTable(prev => prev.map((t, i) => i === idx ? { ...t, maxWeight: isNaN(v) ? 0 : v } : t));
                  }}
                />
                <Input
                  className="col-span-5"
                  type="number" step="0.01" min="0"
                  value={tier.cost}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setFreightTable(prev => prev.map((t, i) => i === idx ? { ...t, cost: isNaN(v) ? 0 : v } : t));
                  }}
                />
                <Button
                  variant="ghost" size="sm"
                  className="col-span-2"
                  onClick={() => setFreightTable(prev => prev.filter((_, i) => i !== idx))}
                  disabled={freightTable.length <= 1}
                >
                  ✕
                </Button>
              </div>
            ))}
            <div className="flex gap-2 mt-3">
              <Button
                variant="outline" size="sm"
                onClick={() => setFreightTable(prev => [...prev, { maxWeight: 0, cost: 0 }])}
              >
                + Adicionar faixa
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => setFreightTable(DEFAULT_FREIGHT_TABLE)}
              >
                Restaurar padrão
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => {
                  const sorted = [...freightTable].sort((a, b) => a.maxWeight - b.maxWeight);
                  setFreightTableMutation.mutate({ table: sorted });
                }}
                disabled={setFreightTableMutation.isPending}
              >
                Salvar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Truck className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Subsídio de Frete Shopee</CardTitle>
              <CardDescription>
                Quanto a Shopee subsidia do frete por faixa de preço do produto. Última faixa = "preço acima" (deixe vazio).
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground">
              <div className="col-span-5">Preço até (R$)</div>
              <div className="col-span-5">Subsídio (R$)</div>
              <div className="col-span-2"></div>
            </div>
            {subsidyTable.map((tier, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <Input
                  className="col-span-5"
                  type="number" step="0.01" min="0.01"
                  placeholder={tier.maxPrice === Infinity ? "∞ (acima)" : ""}
                  value={tier.maxPrice === Infinity ? "" : tier.maxPrice}
                  onChange={e => {
                    const raw = e.target.value;
                    const v = raw === "" ? Infinity : parseFloat(raw);
                    setSubsidyTable(prev => prev.map((t, i) => i === idx ? { ...t, maxPrice: isNaN(v) ? 0 : v } : t));
                  }}
                />
                <Input
                  className="col-span-5"
                  type="number" step="0.01" min="0"
                  value={tier.subsidy}
                  onChange={e => {
                    const v = parseFloat(e.target.value);
                    setSubsidyTable(prev => prev.map((t, i) => i === idx ? { ...t, subsidy: isNaN(v) ? 0 : v } : t));
                  }}
                />
                <Button
                  variant="ghost" size="sm"
                  className="col-span-2"
                  onClick={() => setSubsidyTable(prev => prev.filter((_, i) => i !== idx))}
                  disabled={subsidyTable.length <= 1}
                >
                  ✕
                </Button>
              </div>
            ))}
            <div className="flex gap-2 mt-3">
              <Button
                variant="outline" size="sm"
                onClick={() => setSubsidyTable(prev => [...prev, { maxPrice: 0, subsidy: 0 }])}
              >
                + Adicionar faixa
              </Button>
              <Button
                variant="outline" size="sm"
                onClick={() => setSubsidyTable(DEFAULT_SUBSIDY_TABLE)}
              >
                Restaurar padrão
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => {
                  const sorted = [...subsidyTable].sort((a, b) => a.maxPrice - b.maxPrice);
                  const payload = sorted.map(t => ({
                    maxPrice: t.maxPrice === Infinity ? null : t.maxPrice,
                    subsidy: t.subsidy,
                  }));
                  setSubsidyTableMutation.mutate({ table: payload });
                }}
                disabled={setSubsidyTableMutation.isPending}
              >
                Salvar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
