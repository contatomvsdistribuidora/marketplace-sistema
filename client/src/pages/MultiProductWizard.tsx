import { useState, useMemo, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import {
  STEPS, type WizardStep, type Listing, type ListingItem,
} from "./multi-product-wizard/types";
import { StepA } from "./multi-product-wizard/StepA";
import { CombinedWizard } from "./multi-product-wizard/CombinedWizard";
import { useResolvedProducts } from "./multi-product-wizard/useResolvedProducts";
import { itemKey, type ResolvedProduct } from "./multi-product-wizard/types";
import { StepB } from "./multi-product-wizard/StepB";
import { StepC } from "./multi-product-wizard/StepC";
import { StepD } from "./multi-product-wizard/StepD";

export default function MultiProductWizard() {
  const urlSearch = useSearch();
  const [, setLocation] = useLocation();

  const listingId = useMemo(() => {
    const p = new URLSearchParams(urlSearch).get("id");
    const n = p ? Number(p) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [urlSearch]);

  const utils = trpc.useUtils();
  const listingQuery = trpc.multiProduct.getMultiProductListing.useQuery(
    { id: listingId! },
    { enabled: listingId !== null, retry: false },
  );

  // Redirect on missing/invalid id or unauthorized listing
  useEffect(() => {
    if (listingId === null) {
      setLocation("/multi-product");
      return;
    }
    if (listingQuery.error) {
      toast.error(listingQuery.error.message || "Anúncio combinado não encontrado.");
      setLocation("/multi-product");
    }
  }, [listingId, listingQuery.error]);

  if (listingId === null || listingQuery.isLoading) {
    return (
      <div className="container mx-auto p-4 lg:p-6 max-w-5xl">
        <Skeleton className="h-8 w-72 mb-4" />
        <Skeleton className="h-14 w-full mb-6" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!listingQuery.data) return null;

  const listing = listingQuery.data.listing as Listing;
  const items = listingQuery.data.items as ListingItem[];

  const invalidate = () =>
    utils.multiProduct.getMultiProductListing.invalidate({ id: listing.id });

  return <WizardInner listing={listing} items={items} invalidate={invalidate} />;
}

function WizardInner({
  listing,
  items,
  invalidate,
}: {
  listing: Listing;
  items: ListingItem[];
  invalidate: () => void;
}) {
  const [step, setStep] = useState<WizardStep>("A");
  const currentStepIndex = STEPS.findIndex((s) => s.key === step);

  const { productMap, isResolving } = useResolvedProducts(listing, items);

  const products: ResolvedProduct[] = items
    .map(it => productMap.get(itemKey(it.source, Number(it.sourceId))))
    .filter((p): p is ResolvedProduct => p !== undefined);

  const principalIndex = Math.max(
    0,
    items.findIndex(it =>
      it.source === listing?.mainProductSource &&
      Number(it.sourceId) === Number(listing?.mainProductSourceId)
    )
  );

  return (
    <div className="container mx-auto p-4 lg:p-6 max-w-5xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">Anúncio Combinado #{listing.id}</h1>
        <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
          <span>{listing.mode === "new" ? "Criar novo anúncio" : "Promover anúncio existente"}</span>
          <span>·</span>
          <Badge variant="outline" className="text-xs">{listing.status}</Badge>
        </div>
      </div>

      {/* Stepper sticky */}
      <div className="sticky top-0 bg-background z-10 pb-4 -mx-4 lg:-mx-6 px-4 lg:px-6">
        <div className="hidden sm:flex items-center px-2 py-3 border rounded-lg bg-card">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1">
              <button
                type="button"
                onClick={() => setStep(s.key)}
                className="flex items-center gap-1.5 px-2"
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${
                    step === s.key
                      ? "bg-orange-500 border-orange-500 text-white"
                      : currentStepIndex > i
                      ? "bg-orange-100 border-orange-300 text-orange-600"
                      : "bg-gray-100 border-gray-300 text-gray-400"
                  }`}
                >
                  {currentStepIndex > i ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </div>
                <span
                  className={`text-xs font-medium ${
                    step === s.key ? "text-orange-600" : "text-gray-400"
                  }`}
                >
                  {s.label}
                </span>
              </button>
              {i < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mx-2 rounded-full ${
                    currentStepIndex > i ? "bg-orange-300" : "bg-gray-200"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="sm:hidden flex items-center justify-between px-3 py-3 border rounded-lg bg-card">
          <span className="text-sm font-medium">
            Step {currentStepIndex + 1} de {STEPS.length}: {STEPS[currentStepIndex].label}
          </span>
        </div>
      </div>

      {/* Step content */}
      <div className="py-4">
        {step === "A" && (
          <StepA
            listing={listing}
            items={items}
            onChange={invalidate}
          />
        )}
        {step === "V" && (
          <CombinedWizard
            products={products}
            multiListingId={listing.id}
            accountId={listing.shopeeAccountId}
            principalIndex={principalIndex}
            onSave={() => invalidate()}
            onClose={() => setStep("A")}
          />
        )}
        {step === "B" && <StepB listing={listing} onChange={invalidate} />}
        {step === "C" && <StepC listing={listing} onChange={invalidate} />}
        {step === "D" && (
          <StepD
            listing={listing}
            items={items}
            onEditStep={(s) => setStep(s)}
            onChange={invalidate}
          />
        )}
      </div>

      {/* Bottom navigation */}
      <div className="flex items-center justify-between pt-6 border-t">
        <Button
          variant="outline"
          onClick={() => {
            const prev: Record<WizardStep, WizardStep> = { A: "A", V: "A", B: "V", C: "B", D: "C" };
            setStep(prev[step]);
          }}
          disabled={step === "A"}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Voltar
        </Button>
        <Button
          onClick={() => {
            const next: Record<WizardStep, WizardStep> = { A: "V", V: "B", B: "C", C: "D", D: "D" };
            setStep(next[step]);
          }}
          disabled={step === "D"}
        >
          Próximo
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>

    </div>
  );
}
