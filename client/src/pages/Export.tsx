import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload, Store, Loader2, Sparkles, CheckCircle, XCircle, AlertCircle,
  ArrowRight, ArrowLeft, Package, Edit3, Save, Info, Link2, RefreshCw, ExternalLink,
  ChevronDown, ChevronUp, Image as ImageIcon, ChevronLeft, ChevronRight, Crown, Tag, Wand2,
  Star, ImagePlus, Type, Settings2, SquareCheck, Square, FileText, Images
} from "lucide-react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

type ExportStep = "select" | "mapping" | "review" | "exporting" | "done";

type ListingType = "gold_pro" | "gold_special" | "free";

interface MappedProduct {
  id: string;
  name: string;
  optimizedTitle?: string;
  titleReasoning?: string;
  titlesPerType?: Record<ListingType, { title: string; reasoning: string }>;
  description: string;
  category: string;
  features: Record<string, string>;
  ean?: string;
  sku?: string;
  mainPrice?: number;
  totalStock?: number;
  imageUrl?: string;
  allImages?: string[];
  coverImageIndex?: number;
  listingType?: ListingType;
  selected?: boolean;
  suggestedCategory?: { id: string; name: string; path: string; confidence: number };
  suggestedAttributes?: { attributeName: string; attributeId: string; value: string; confidence: number; source: string; required?: boolean }[];
  mlCategoryAttributes?: { id: string; name: string; type: string; values: { id: string; name: string }[]; required: boolean; allowCustomValue: boolean }[];
  status: "pending" | "mapped" | "error";
  errorMessage?: string;
}

// Connected account from our system (ML, TikTok, etc.)
interface ConnectedAccount {
  id: number;
  name: string;
  marketplace: string; // "mercadolivre" | "tiktok"
  isActive: boolean;
  icon?: string;
}

const LISTING_TYPE_OPTIONS: { value: ListingType; label: string; description: string; icon: React.ReactNode; color: string }[] = [
  { value: "free", label: "Grátis", description: "Sem custo, menor visibilidade", icon: <Tag className="h-3.5 w-3.5" />, color: "text-gray-600" },
  { value: "gold_special", label: "Clássico", description: "Custo padrão, boa visibilidade", icon: <Star className="h-3.5 w-3.5" />, color: "text-amber-600" },
  { value: "gold_pro", label: "Premium", description: "Maior custo, máxima visibilidade + frete grátis", icon: <Crown className="h-3.5 w-3.5" />, color: "text-purple-600" },
];

const TITLE_STYLE_OPTIONS = [
  { value: "seo", label: "SEO", description: "Otimizado para busca" },
  { value: "descriptive", label: "Descritivo", description: "Detalhes do produto" },
  { value: "short", label: "Curto", description: "Conciso e direto" },
  { value: "custom", label: "Personalizado", description: "Instrução própria" },
];

export default function ExportPage() {
  const [, setLocation] = useLocation();
  const [step, setStep] = useState<ExportStep>("select");
  const [selectedMarketplace, setSelectedMarketplace] = useState<string>("");
  const [selectedAccount, setSelectedAccount] = useState<string>(""); // "marketplace:accountId"
  const [mappedProducts, setMappedProducts] = useState<MappedProduct[]>([]);
  const [mappingProgress, setMappingProgress] = useState(0);
  const [isMappingInProgress, setIsMappingInProgress] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportJobId, setExportJobId] = useState<number | null>(null);
  const [editingProduct, setEditingProduct] = useState<string | null>(null);
  const [preSelectedIds, setPreSelectedIds] = useState<number[]>([]);
  const [preSelectedTag, setPreSelectedTag] = useState<string>("");
  const [reExportJobId, setReExportJobId] = useState<number | null>(null);
  const [reExportMarketplaceId, setReExportMarketplaceId] = useState<number | null>(null);
  const [reExportMappedData, setReExportMappedData] = useState<Record<string, { mappedCategory: string | null; mappedAttributes: any }>>({});

  // Batch action states
  const [selectedListingTypes, setSelectedListingTypes] = useState<ListingType[]>(["gold_special"]);
  const [batchTitleStyle, setBatchTitleStyle] = useState<string>("seo");
  const [customTitleInstruction, setCustomTitleInstruction] = useState("");
  const [isGeneratingTitles, setIsGeneratingTitles] = useState(false);
  const [titleGenProgress, setTitleGenProgress] = useState(0);
  const [titlePerType, setTitlePerType] = useState(false);
  const [loadingImagesFor, setLoadingImagesFor] = useState<Set<string>>(new Set());
  const [expandedProducts, setExpandedProducts] = useState<Set<string>>(new Set());
  const [loadingAttrsFor, setLoadingAttrsFor] = useState<Set<string>>(new Set());
  const [generatingImageFor, setGeneratingImageFor] = useState<Set<string>>(new Set());
  const [imageGenStyle, setImageGenStyle] = useState<"white_background" | "lifestyle" | "enhanced" | "product_photo">("white_background");

  const { data: tokenData } = trpc.settings.getToken.useQuery();
  const { data: inventoryData } = trpc.settings.getInventoryId.useQuery();
  const inventoryId = inventoryData?.inventoryId;

  const { data: marketplaces } = trpc.marketplaces.list.useQuery();

  // Fetch connected accounts from our system (NOT BaseLinker)
  const { data: mlAccounts, refetch: refetchMlAccounts } = trpc.ml.accounts.useQuery();
  const { data: tiktokAccounts, refetch: refetchTiktokAccounts } = trpc.tiktok.accounts.useQuery();

  // Build unified list of connected accounts from our system
  const connectedAccounts = useMemo<ConnectedAccount[]>(() => {
    const accounts: ConnectedAccount[] = [];

    // ML accounts
    if (mlAccounts) {
      for (const acc of mlAccounts as any[]) {
        accounts.push({
          id: acc.id,
          name: acc.nickname || `ML Account #${acc.id}`,
          marketplace: "mercadolivre",
          isActive: acc.isActive,
          icon: undefined,
        });
      }
    }

    // TikTok accounts
    if (tiktokAccounts) {
      for (const acc of tiktokAccounts as any[]) {
        accounts.push({
          id: acc.id,
          name: acc.shopName || acc.sellerName || `TikTok #${acc.id}`,
          marketplace: "tiktok",
          isActive: true,
          icon: undefined,
        });
      }
    }

    return accounts;
  }, [mlAccounts, tiktokAccounts]);

  // Get selected marketplace info
  const selectedMarketplaceInfo = useMemo(() => {
    if (!selectedMarketplace || !marketplaces) return null;
    return (marketplaces as any[]).find((m: any) => String(m.id) === selectedMarketplace) || null;
  }, [selectedMarketplace, marketplaces]);

  // Map marketplace codes to our connected account types
  const MARKETPLACE_CODE_TO_ACCOUNT_TYPE: Record<string, string[]> = {
    mercadolivre: ["mercadolivre"],
    tiktok: ["tiktok"],
    shopee: [],
    amazon: [],
    madeiramadeira: [],
    magalu: [],
    leroymerlin: [],
    americanas: [],
    casasbahia: [],
    carrefour: [],
    kabum: [],
    shein: [],
    olist: [],
    aliexpress: [],
    dafiti: [],
    netshoes: [],
  };

  // Filter connected accounts by selected marketplace
  const filteredAccounts = useMemo(() => {
    if (!selectedMarketplaceInfo) return [];
    const mpCode = (selectedMarketplaceInfo as any).code?.toLowerCase();
    if (!mpCode) return [];
    const accountTypes = MARKETPLACE_CODE_TO_ACCOUNT_TYPE[mpCode];
    if (!accountTypes || accountTypes.length === 0) return [];
    return connectedAccounts.filter(a => accountTypes.includes(a.marketplace) && a.isActive);
  }, [connectedAccounts, selectedMarketplaceInfo]);

  // Check if the selected marketplace has API support
  const hasDirectApiSupport = useMemo(() => {
    if (!selectedMarketplaceInfo) return false;
    const mpCode = (selectedMarketplaceInfo as any).code?.toLowerCase();
    if (!mpCode) return false;
    const accountTypes = MARKETPLACE_CODE_TO_ACCOUNT_TYPE[mpCode];
    return accountTypes && accountTypes.length > 0;
  }, [selectedMarketplaceInfo]);

  // Get selected account info
  const selectedAccountInfo = useMemo(() => {
    if (!selectedAccount) return null;
    const [marketplace, accountIdStr] = selectedAccount.split(":");
    const accountId = parseInt(accountIdStr);
    return connectedAccounts.find(a => a.marketplace === marketplace && a.id === accountId) || null;
  }, [selectedAccount, connectedAccounts]);

  // Selection helpers
  const selectedProducts = useMemo(() => mappedProducts.filter(p => p.selected), [mappedProducts]);
  const allSelected = useMemo(() => mappedProducts.length > 0 && mappedProducts.every(p => p.selected), [mappedProducts]);
  const someSelected = useMemo(() => mappedProducts.some(p => p.selected), [mappedProducts]);

  // Load pre-selected product IDs from sessionStorage
  useEffect(() => {
    const reExportId = sessionStorage.getItem("reexport_job_id");
    const reExportTag = sessionStorage.getItem("reexport_job_tag");
    if (reExportId) {
      setReExportJobId(parseInt(reExportId));
      if (reExportTag) setPreSelectedTag(reExportTag);
      sessionStorage.removeItem("reexport_job_id");
      sessionStorage.removeItem("reexport_job_tag");
      return;
    }

    const storedIds = sessionStorage.getItem("export_product_ids");
    const storedTag = sessionStorage.getItem("export_tag");
    if (storedIds) {
      try {
        const ids = JSON.parse(storedIds) as string[];
        setPreSelectedIds(ids.map(id => parseInt(id)).filter(id => !isNaN(id)));
      } catch (e) {
        console.error("Error parsing stored product IDs:", e);
      }
    }
    if (storedTag) {
      setPreSelectedTag(storedTag);
    }
  }, []);

  // Fetch products from a previous job for re-export
  const { data: reExportData, isLoading: reExportLoading } = trpc.exports.getJobProducts.useQuery(
    { jobId: reExportJobId! },
    { enabled: !!reExportJobId }
  );

  useEffect(() => {
    if (reExportData && reExportData.products.length > 0 && preSelectedIds.length === 0 && mappedProducts.length === 0) {
      const ids = reExportData.products
        .map((p: any) => parseInt(p.productId))
        .filter((id: number) => !isNaN(id));
      if (ids.length > 0) {
        setPreSelectedIds(ids);
        if (reExportData.jobMarketplaceId) {
          setReExportMarketplaceId(reExportData.jobMarketplaceId);
        }
        const mappedDataMap: Record<string, { mappedCategory: string | null; mappedAttributes: any }> = {};
        for (const p of reExportData.products) {
          mappedDataMap[p.productId] = {
            mappedCategory: p.mappedCategory,
            mappedAttributes: p.mappedAttributes,
          };
        }
        setReExportMappedData(mappedDataMap);
        toast.info(`${ids.length} produtos carregados do Job #${reExportJobId} para re-exportação.`);
      }
    }
  }, [reExportData]);

  // Fetch pre-selected products from cache
  const { data: preSelectedProducts, isLoading: preSelectedLoading } = trpc.baselinker.getProductsByIds.useQuery(
    { inventoryId: inventoryId!, productIds: preSelectedIds },
    { enabled: !!inventoryId && preSelectedIds.length > 0 }
  );

  const isLoadingProducts = preSelectedLoading || reExportLoading;

  // Auto-populate mapped products from pre-selected products
  useEffect(() => {
    if (preSelectedProducts && preSelectedProducts.length > 0 && mappedProducts.length === 0) {
      setMappedProducts(
        preSelectedProducts.map((p: any) => ({
          id: String(p.id),
          name: p.name || "",
          description: p.description || "",
          category: String(p.categoryId || ""),
          features: {},
          ean: p.ean || "",
          sku: p.sku || "",
          mainPrice: p.mainPrice || 0,
          totalStock: p.totalStock || 0,
          imageUrl: p.imageUrl || "",
          selected: true,
          listingType: "gold_special" as ListingType,
          status: "pending" as const,
        }))
      );
      sessionStorage.removeItem("export_product_ids");
      sessionStorage.removeItem("export_tag");
    }
  }, [preSelectedProducts]);

  const mapCategoryMutation = trpc.ai.mapCategory.useMutation();
  const fillAttributesMutation = trpc.ai.fillAttributes.useMutation();
  const generateTitleMutation = trpc.ai.generateTitle.useMutation();
  const batchGenerateTitlesMutation = trpc.ai.batchGenerateTitles.useMutation();
  const createExportMutation = trpc.exports.create.useMutation();
  const updateExportMutation = trpc.exports.updateStatus.useMutation();
  const addLogMutation = trpc.exports.addLog.useMutation();
  const mlPublishMutation = trpc.ml.publishProduct.useMutation();
  const generateImageMutation = trpc.ai.generateProductImage.useMutation();
  const generateDescriptionMutation = trpc.ai.generateDescription.useMutation();

  // Batch image generation states
  const [isBatchGeneratingImages, setIsBatchGeneratingImages] = useState(false);
  const [batchImageGenProgress, setBatchImageGenProgress] = useState(0);

  // Description generation states
  const [generatingDescFor, setGeneratingDescFor] = useState<Set<string>>(new Set());
  const [descriptionStyle, setDescriptionStyle] = useState<"seo" | "detailed" | "short">("seo");

  // Check if this is a re-export to the same marketplace type (can skip AI mapping)
  const canSkipMapping = useMemo(() => {
    if (!reExportJobId || !reExportMarketplaceId || !selectedMarketplace) return false;
    return reExportMarketplaceId.toString() === selectedMarketplace;
  }, [reExportJobId, reExportMarketplaceId, selectedMarketplace]);

  const hasPreviousMappedData = useMemo(() => {
    return Object.keys(reExportMappedData).length > 0;
  }, [reExportMappedData]);

  // ===== TOGGLE SELECTION =====
  const toggleSelectAll = useCallback(() => {
    const newVal = !allSelected;
    setMappedProducts(prev => prev.map(p => ({ ...p, selected: newVal })));
  }, [allSelected]);

  const toggleSelectProduct = useCallback((productId: string) => {
    setMappedProducts(prev => prev.map(p =>
      p.id === productId ? { ...p, selected: !p.selected } : p
    ));
  }, []);

  // ===== TOGGLE LISTING TYPE =====
  const toggleListingType = useCallback((type: ListingType) => {
    setSelectedListingTypes(prev => {
      if (prev.includes(type)) {
        // Don't allow removing the last one
        if (prev.length === 1) {
          toast.error("Selecione pelo menos 1 tipo de anúncio.");
          return prev;
        }
        return prev.filter(t => t !== type);
      } else {
        if (prev.length >= 3) {
          toast.error("Máximo de 3 tipos de anúncio simultâneos.");
          return prev;
        }
        return [...prev, type];
      }
    });
  }, []);

  // Total publications count
  const totalPublications = useMemo(() => {
    return selectedProducts.filter(p => p.status === "mapped").length * selectedListingTypes.length;
  }, [selectedProducts, selectedListingTypes]);

  // ===== BATCH TITLE GENERATION =====
  const handleBatchGenerateTitles = useCallback(async () => {
    const selected = mappedProducts.filter(p => p.selected && p.status === "mapped");
    if (selected.length === 0) {
      toast.error("Selecione pelo menos um produto mapeado para gerar títulos.");
      return;
    }

    setIsGeneratingTitles(true);
    setTitleGenProgress(0);

    const marketplace = (marketplaces || []).find((m: any) => m.id.toString() === selectedMarketplace);
    const marketplaceName = marketplace?.name || "Marketplace";
    const accountName = selectedAccountInfo?.name || "";
    const mkLabel = `${marketplaceName} (${accountName})`;

    try {
      if (titlePerType && selectedListingTypes.length > 1) {
        // Generate different titles for each listing type
        const typeLabels: Record<ListingType, string> = {
          free: "Grátis (título curto e direto)",
          gold_special: "Clássico (título descritivo)",
          gold_pro: "Premium (título SEO completo com palavras-chave)",
        };

        let completedTypes = 0;
        const perTypeResults: Record<ListingType, Record<string, { title: string; reasoning: string }>> = {} as any;

        for (const lt of selectedListingTypes) {
          const styleInstruction = `Gere um título otimizado para anúncio tipo ${typeLabels[lt]}. ${batchTitleStyle === "custom" && customTitleInstruction ? customTitleInstruction : ""}`;

          const results = await batchGenerateTitlesMutation.mutateAsync({
            products: selected.map(p => ({
              id: p.id,
              name: p.name,
              description: p.description || "",
              features: p.features || {},
              category: p.suggestedCategory?.name || p.category || "",
              ean: p.ean,
            })),
            marketplace: mkLabel,
            style: "custom" as any,
            customInstruction: styleInstruction,
          });

          perTypeResults[lt] = results;
          completedTypes++;
          setTitleGenProgress(Math.round((completedTypes / selectedListingTypes.length) * 100));
        }

        // Update products with per-type titles
        setMappedProducts(prev => prev.map(p => {
          const titlesPerType: Record<ListingType, { title: string; reasoning: string }> = {} as any;
          let mainTitle = p.optimizedTitle || p.name;
          let mainReasoning = p.titleReasoning || "";

          for (const lt of selectedListingTypes) {
            const result = perTypeResults[lt]?.[p.id];
            if (result) {
              titlesPerType[lt] = result;
              // Use first type's title as the main optimizedTitle
              if (lt === selectedListingTypes[0]) {
                mainTitle = result.title;
                mainReasoning = result.reasoning;
              }
            }
          }

          if (Object.keys(titlesPerType).length > 0) {
            return { ...p, optimizedTitle: mainTitle, titleReasoning: mainReasoning, titlesPerType };
          }
          return p;
        }));

        toast.success(`Títulos gerados para ${selected.length} produto(s) × ${selectedListingTypes.length} tipos de anúncio.`);
      } else {
        // Single title for all types
        const results = await batchGenerateTitlesMutation.mutateAsync({
          products: selected.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description || "",
            features: p.features || {},
            category: p.suggestedCategory?.name || p.category || "",
            ean: p.ean,
          })),
          marketplace: mkLabel,
          style: batchTitleStyle as any,
          customInstruction: batchTitleStyle === "custom" ? customTitleInstruction : undefined,
        });

        setMappedProducts(prev => prev.map(p => {
          const result = results[p.id];
          if (result) {
            return { ...p, optimizedTitle: result.title, titleReasoning: result.reasoning, titlesPerType: undefined };
          }
          return p;
        }));

        const successCount = Object.keys(results).length;
        toast.success(`${successCount} título(s) gerado(s) com estilo "${TITLE_STYLE_OPTIONS.find(o => o.value === batchTitleStyle)?.label}".`);
      }
    } catch (error: any) {
      toast.error(`Erro ao gerar títulos: ${error.message}`);
    } finally {
      setIsGeneratingTitles(false);
      setTitleGenProgress(0);
    }
  }, [mappedProducts, selectedMarketplace, selectedAccountInfo, marketplaces, batchTitleStyle, customTitleInstruction, titlePerType, selectedListingTypes]);

  // ===== LOAD ALL IMAGES FOR A PRODUCT =====
  const loadAllImages = useCallback(async (productId: string) => {
    if (!inventoryId) return;
    const numId = parseInt(productId);
    if (isNaN(numId)) return;

    setLoadingImagesFor(prev => new Set(prev).add(productId));
    try {
      const details = await new Promise<any>((resolve, reject) => {
        // Use a direct fetch since we need imperative access
        const url = `/api/trpc/baselinker.getProductDetails?input=${encodeURIComponent(JSON.stringify({ inventoryId, productIds: [numId] }))}`;
        fetch(url)
          .then(r => r.json())
          .then(data => resolve(data?.result?.data || {}))
          .catch(reject);
      });

      const fullProduct = details ? Object.values(details)[0] as any : null;
      const images: string[] = [];
      if (fullProduct?.images) {
        const entries = Object.entries(fullProduct.images).sort(([a], [b]) => Number(a) - Number(b));
        for (const [, url] of entries) {
          if (url) images.push(url as string);
        }
      }

      // Also extract features from text_fields
      let extractedFeatures: Record<string, string> = {};
      if (fullProduct?.text_fields?.features) {
        try {
          const parsed = typeof fullProduct.text_fields.features === "string"
            ? JSON.parse(fullProduct.text_fields.features)
            : fullProduct.text_fields.features;
          extractedFeatures = parsed;
        } catch { /* ignore */ }
      }

      setMappedProducts(prev => prev.map(p => {
        if (p.id !== productId) return p;
        const product = p;
        const currentImage = product.imageUrl;
        // If no images found, keep the current imageUrl
        if (images.length === 0 && currentImage) {
          return { ...p, allImages: [currentImage], coverImageIndex: 0, features: { ...p.features, ...extractedFeatures } };
        }
        return { ...p, allImages: images, coverImageIndex: 0, features: { ...p.features, ...extractedFeatures } };
      }));
    } catch (error: any) {
      console.error("Error loading images:", error);
      toast.error(`Erro ao carregar imagens do produto ${productId}`);
    } finally {
      setLoadingImagesFor(prev => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }
  }, [inventoryId]);

  // ===== LOAD ML CATEGORY ATTRIBUTES =====
  const loadCategoryAttributes = useCallback(async (productId: string, categoryId: string) => {
    if (!categoryId || !categoryId.match(/^MLB\d+$/)) return;

    setLoadingAttrsFor(prev => new Set(prev).add(productId));
    try {
      const url = `/api/trpc/ml.getCategoryAttributes?input=${encodeURIComponent(JSON.stringify({ categoryId }))}`;
      const resp = await fetch(url);
      const data = await resp.json();
      const attrs = data?.result?.data || [];

      setMappedProducts(prev => prev.map(p => {
        if (p.id !== productId) return p;
        return { ...p, mlCategoryAttributes: attrs };
      }));
    } catch (error: any) {
      console.error("Error loading category attributes:", error);
    } finally {
      setLoadingAttrsFor(prev => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }
  }, []);

  // ===== GENERATE IMAGE WITH AI =====
  const handleGenerateImage = useCallback(async (productId: string) => {
    const product = mappedProducts.find(p => p.id === productId);
    if (!product) return;

    setGeneratingImageFor(prev => new Set(prev).add(productId));
    try {
      const result = await generateImageMutation.mutateAsync({
        productName: product.optimizedTitle || product.name,
        productDescription: product.description?.substring(0, 300) || undefined,
        originalImageUrl: product.imageUrl || undefined,
        style: imageGenStyle,
      });

      if (result.url) {
        setMappedProducts(prev => prev.map(p => {
          if (p.id !== productId) return p;
          const newImages = [...(p.allImages || []), result.url!];
          return { ...p, allImages: newImages, coverImageIndex: newImages.length - 1 };
        }));
        toast.success("Foto gerada com IA e definida como capa!");
      }
    } catch (error: any) {
      toast.error(`Erro ao gerar imagem: ${error.message}`);
    } finally {
      setGeneratingImageFor(prev => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }
  }, [mappedProducts, imageGenStyle]);

  // ===== BATCH GENERATE IMAGES WITH AI =====
  const handleBatchGenerateImages = useCallback(async () => {
    const selected = mappedProducts.filter(p => p.selected && p.status === "mapped");
    if (selected.length === 0) {
      toast.error("Selecione pelo menos um produto mapeado para gerar fotos.");
      return;
    }

    setIsBatchGeneratingImages(true);
    setBatchImageGenProgress(0);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < selected.length; i++) {
      const product = selected[i];
      try {
        const result = await generateImageMutation.mutateAsync({
          productName: product.optimizedTitle || product.name,
          productDescription: product.description?.substring(0, 300) || undefined,
          originalImageUrl: product.imageUrl || undefined,
          style: imageGenStyle,
        });

        if (result.url) {
          setMappedProducts(prev => prev.map(p => {
            if (p.id !== product.id) return p;
            const newImages = [...(p.allImages || []), result.url!];
            return { ...p, allImages: newImages, coverImageIndex: newImages.length - 1 };
          }));
          successCount++;
        }
      } catch (error: any) {
        errorCount++;
        console.error(`Error generating image for ${product.id}:`, error);
      }

      setBatchImageGenProgress(Math.round(((i + 1) / selected.length) * 100));
      // Small delay between API calls
      if (i < selected.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setIsBatchGeneratingImages(false);
    setBatchImageGenProgress(0);

    if (errorCount > 0) {
      toast.warning(`Fotos geradas: ${successCount} sucesso, ${errorCount} erro(s).`);
    } else {
      toast.success(`${successCount} foto(s) gerada(s) com IA e definida(s) como capa!`);
    }
  }, [mappedProducts, imageGenStyle]);

  // ===== GENERATE DESCRIPTION WITH AI =====
  const handleGenerateDescription = useCallback(async (productId: string) => {
    const product = mappedProducts.find(p => p.id === productId);
    if (!product) return;

    const marketplace = (marketplaces || []).find((m: any) => m.id.toString() === selectedMarketplace);
    const marketplaceName = marketplace?.name || "Marketplace";

    setGeneratingDescFor(prev => new Set(prev).add(productId));
    try {
      const result = await generateDescriptionMutation.mutateAsync({
        product: {
          name: product.optimizedTitle || product.name,
          description: product.description || "",
          features: product.features || {},
          category: product.suggestedCategory?.name || product.category || "",
          ean: product.ean,
        },
        marketplace: marketplaceName,
        style: descriptionStyle,
      });

      if (result.description) {
        setMappedProducts(prev => prev.map(p =>
          p.id === productId ? { ...p, description: result.description } : p
        ));
        toast.success(`Descrição gerada para "${product.name.substring(0, 30)}..."`);
      }
    } catch (error: any) {
      toast.error(`Erro ao gerar descrição: ${error.message}`);
    } finally {
      setGeneratingDescFor(prev => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
    }
  }, [mappedProducts, selectedMarketplace, marketplaces, descriptionStyle]);

  // ===== CHANGE COVER IMAGE =====
  const setCoverImage = useCallback((productId: string, imageIndex: number) => {
    setMappedProducts(prev => prev.map(p =>
      p.id === productId ? { ...p, coverImageIndex: imageIndex } : p
    ));
    toast.success("Foto de capa alterada!");
  }, []);

  // ===== TOGGLE EXPANDED =====
  const toggleExpanded = useCallback((productId: string) => {
    setExpandedProducts(prev => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
        // Auto-load images when expanding
        const product = mappedProducts.find(p => p.id === productId);
        if (product && !product.allImages) {
          loadAllImages(productId);
        }
        // Auto-load ML category attributes when expanding
        if (product && product.suggestedCategory?.id && !product.mlCategoryAttributes) {
          loadCategoryAttributes(productId, product.suggestedCategory.id);
        }
      }
      return next;
    });
  }, [mappedProducts, loadAllImages, loadCategoryAttributes]);

  const handleStartMapping = async () => {
    if (!selectedMarketplace) {
      toast.error("Selecione um marketplace de destino");
      return;
    }
    if (!selectedAccount) {
      toast.error("Selecione a conta de destino");
      return;
    }
    if (mappedProducts.length === 0) {
      toast.error("Nenhum produto selecionado para exportar");
      return;
    }

    setIsMappingInProgress(true);
    setStep("mapping");
    setMappingProgress(0);

    const marketplace = (marketplaces || []).find((m: any) => m.id.toString() === selectedMarketplace);
    const marketplaceName = marketplace?.name || "Marketplace";
    const accountName = selectedAccountInfo?.name || "";

    // If re-exporting to same marketplace type and we have previous mapped data, skip AI mapping
    if (canSkipMapping && hasPreviousMappedData) {
      toast.info("Re-exportação para mesmo marketplace detectada. Reutilizando mapeamento anterior...");
      let reusedCount = 0;
      let newMappingCount = 0;

      for (let i = 0; i < mappedProducts.length; i++) {
        const product = mappedProducts[i];
        const previousData = reExportMappedData[product.id];

        if (previousData && (previousData.mappedCategory || previousData.mappedAttributes)) {
          const attrs = previousData.mappedAttributes as any[];
          setMappedProducts((prev) =>
            prev.map((p) =>
              p.id === product.id
                ? {
                    ...p,
                    suggestedCategory: previousData.mappedCategory
                      ? {
                          id: previousData.mappedCategory,
                          name: previousData.mappedCategory,
                          path: previousData.mappedCategory,
                          confidence: 100,
                        }
                      : undefined,
                    suggestedAttributes: Array.isArray(attrs) ? attrs : undefined,
                    status: "mapped" as const,
                  }
                : p
            )
          );
          reusedCount++;
        } else {
          try {
            const categorySuggestions = await mapCategoryMutation.mutateAsync({
              product: {
                name: product.name,
                description: product.description,
                features: product.features,
                category: product.category,
                ean: product.ean,
                sku: product.sku,
              },
              marketplace: `${marketplaceName} (${accountName})`,
              availableCategories: [],
            });

            const attributeSuggestions = await fillAttributesMutation.mutateAsync({
              product: {
                name: product.name,
                description: product.description,
                features: product.features,
                category: product.category,
              },
              requiredAttributes: [
                { name: "Marca", id: "brand", required: true },
                { name: "Modelo", id: "model", required: true },
                { name: "Cor", id: "color", required: false },
                { name: "Material", id: "material", required: false },
              ],
              marketplace: `${marketplaceName} (${accountName})`,
            });

            setMappedProducts((prev) =>
              prev.map((p) =>
                p.id === product.id
                  ? {
                      ...p,
                      suggestedCategory: categorySuggestions?.[0] ? {
                          id: categorySuggestions[0].categoryId,
                          name: categorySuggestions[0].categoryName,
                          path: categorySuggestions[0].categoryPath,
                          confidence: categorySuggestions[0].confidence,
                        } : undefined,
                      suggestedAttributes: attributeSuggestions || undefined,
                      status: "mapped" as const,
                    }
                  : p
              )
            );
            newMappingCount++;
          } catch (error: any) {
            setMappedProducts((prev) =>
              prev.map((p) =>
                p.id === product.id
                  ? { ...p, status: "error" as const, errorMessage: error.message }
                  : p
              )
            );
          }
        }

        setMappingProgress(Math.round(((i + 1) / mappedProducts.length) * 100));
      }

      toast.success(`Mapeamento concluído: ${reusedCount} reutilizados, ${newMappingCount} novos.`);
    } else {
      // Normal AI mapping
      for (let i = 0; i < mappedProducts.length; i++) {
        const product = mappedProducts[i];
        try {
          // Run category mapping and attribute fill in parallel (titles are generated on-demand in Review step)
          const [categorySuggestions, attributeSuggestions] = await Promise.all([
            mapCategoryMutation.mutateAsync({
              product: {
                name: product.name,
                description: product.description,
                features: product.features,
                category: product.category,
                ean: product.ean,
                sku: product.sku,
              },
              marketplace: `${marketplaceName} (${accountName})`,
              availableCategories: [],
            }),
            fillAttributesMutation.mutateAsync({
              product: {
                name: product.name,
                description: product.description,
                features: product.features,
                category: product.category,
              },
              requiredAttributes: [
                { name: "Marca", id: "brand", required: true },
                { name: "Modelo", id: "model", required: true },
                { name: "Cor", id: "color", required: false },
                { name: "Material", id: "material", required: false },
              ],
              marketplace: `${marketplaceName} (${accountName})`,
            }),
          ]);

          setMappedProducts((prev) =>
            prev.map((p) =>
              p.id === product.id
                ? {
                    ...p,
                    suggestedCategory: categorySuggestions?.[0] ? {
                        id: categorySuggestions[0].categoryId,
                        name: categorySuggestions[0].categoryName,
                        path: categorySuggestions[0].categoryPath,
                        confidence: categorySuggestions[0].confidence,
                      } : undefined,
                    suggestedAttributes: attributeSuggestions || undefined,
                    status: "mapped" as const,
                  }
                : p
            )
          );
        } catch (error: any) {
          setMappedProducts((prev) =>
            prev.map((p) =>
              p.id === product.id
                ? { ...p, status: "error" as const, errorMessage: error.message }
                : p
            )
          );
        }

        setMappingProgress(Math.round(((i + 1) / mappedProducts.length) * 100));
      }
    }

    setIsMappingInProgress(false);
    setStep("review");
    toast.success("Mapeamento concluído! Revise os resultados antes de exportar.");

    // Auto-load images for all products when entering review
    if (inventoryId) {
      for (const product of mappedProducts) {
        if (!product.allImages) {
          loadAllImages(product.id);
          // Small delay to avoid overwhelming the API
          await new Promise(r => setTimeout(r, 200));
        }
      }
    }
  };

  const handleExport = async () => {
    const marketplace = (marketplaces || []).find((m: any) => m.id.toString() === selectedMarketplace);
    if (!marketplace || !selectedAccountInfo) return;

    const mpCode = (selectedMarketplaceInfo as any)?.code?.toLowerCase() || "";

    // Only export selected + mapped products
    const productsToExport = mappedProducts.filter(p => p.selected !== false && p.status === "mapped");
    if (productsToExport.length === 0) {
      toast.error("Nenhum produto selecionado e mapeado para exportar.");
      return;
    }

    // Build publication tasks: each product x each selected listing type
    const pubTasks: { product: MappedProduct; listingType: ListingType; title: string }[] = [];
    for (const product of productsToExport) {
      for (const lt of selectedListingTypes) {
        // If titlePerType is on and we have per-type titles, use them
        let title = product.optimizedTitle || product.name;
        if (titlePerType && product.titlesPerType && product.titlesPerType[lt]) {
          title = product.titlesPerType[lt].title;
        }
        pubTasks.push({ product, listingType: lt, title });
      }
    }

    const totalTasks = pubTasks.length;

    setStep("exporting");
    setExportProgress(0);

    const { jobId } = await createExportMutation.mutateAsync({
      marketplaceId: marketplace.id,
      totalProducts: totalTasks,
      tagFilter: preSelectedTag || undefined,
    });

    if (!jobId) {
      toast.error("Erro ao criar job de exportação");
      return;
    }

    setExportJobId(jobId);
    await updateExportMutation.mutateAsync({ jobId, status: "processing" });

    const typesLabel = selectedListingTypes.map(t => LISTING_TYPE_OPTIONS.find(o => o.value === t)?.label).join(" + ");
    toast.info(`Publicando ${totalTasks} anúncios (${productsToExport.length} produtos × ${selectedListingTypes.length} tipos: ${typesLabel}) via API do ${marketplace.name}...`, { duration: 5000 });

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < pubTasks.length; i++) {
      const { product, listingType, title } = pubTasks[i];

      try {
        // Build features from suggested attributes
        const features: Record<string, string> = {};
        if (product.suggestedAttributes) {
          for (const attr of product.suggestedAttributes) {
            if (attr.value) {
              features[attr.attributeName] = attr.value;
            }
          }
        }

        // Build images array with cover image first
        let images: string[] = [];
        if (product.allImages && product.allImages.length > 0) {
          const coverIdx = product.coverImageIndex || 0;
          images = [product.allImages[coverIdx]];
          for (let j = 0; j < product.allImages.length; j++) {
            if (j !== coverIdx) images.push(product.allImages[j]);
          }
        } else if (product.imageUrl) {
          images = [product.imageUrl];
        }

        const typeLabel = LISTING_TYPE_OPTIONS.find(o => o.value === listingType)?.label || listingType;

        if (mpCode === "mercadolivre") {
          // ===== DIRECT ML API EXPORT WITH LISTING TYPE FALLBACK =====
          const listingTypeFallback: ListingType[] = [listingType];
          if (listingType !== "gold_special") listingTypeFallback.push("gold_special");
          if (listingType !== "free") listingTypeFallback.push("free");

          let mlResult: any = null;
          let usedListingType = listingType;

          for (const tryType of listingTypeFallback) {
            mlResult = await mlPublishMutation.mutateAsync({
              accountId: selectedAccountInfo.id,
              productId: product.id,
              name: title,
              description: product.description || undefined,
              price: product.mainPrice || 0,
              stock: product.totalStock || 1,
              ean: product.ean || undefined,
              sku: product.sku || undefined,
              brand: features["Marca"] || features["brand"] || undefined,
              images: images.length > 0 ? images : undefined,
              features,
              categoryId: product.suggestedCategory?.id || undefined,
              listingType: tryType,
            });

            usedListingType = tryType;

            if (mlResult.success || !mlResult.error?.includes("listing_type")) {
              break;
            }

            if (tryType !== listingTypeFallback[listingTypeFallback.length - 1]) {
              const fallbackLabel = LISTING_TYPE_OPTIONS.find(o => o.value === listingTypeFallback[listingTypeFallback.indexOf(tryType) + 1])?.label;
              toast.info(`Tipo "${LISTING_TYPE_OPTIONS.find(o => o.value === tryType)?.label}" indisponível para "${product.name.substring(0, 25)}...", tentando "${fallbackLabel}"...`, { duration: 3000 });
              await new Promise(r => setTimeout(r, 500));
            }
          }

          await addLogMutation.mutateAsync({
            jobId,
            productId: product.id,
            productName: `${product.name} [${typeLabel}]`,
            marketplaceId: marketplace.id,
            status: mlResult.success ? "success" : "error",
            errorMessage: mlResult.error || undefined,
          });

          if (mlResult.success) {
            successCount++;
            const permalink = mlResult.permalink ? ` - ${mlResult.permalink}` : "";
            const usedLabel = LISTING_TYPE_OPTIONS.find(o => o.value === usedListingType)?.label || usedListingType;
            toast.success(`"${product.name.substring(0, 25)}..." publicado (${usedLabel})${permalink}`, { duration: 4000 });
          } else {
            errorCount++;
            toast.error(`Erro ML (${typeLabel}): "${product.name.substring(0, 25)}...": ${mlResult.error}`, { duration: 4000 });
          }
        } else if (mpCode === "tiktok") {
          errorCount++;
          await addLogMutation.mutateAsync({
            jobId,
            productId: product.id,
            productName: product.name,
            marketplaceId: marketplace.id,
            status: "error",
            errorMessage: "TikTok Shop: use a página 'Publicar no TikTok' para publicação individual por enquanto.",
          });
          toast.error(`TikTok: Use a página dedicada para publicar "${product.name.substring(0, 30)}..."`, { duration: 4000 });
        } else {
          errorCount++;
          await addLogMutation.mutateAsync({
            jobId,
            productId: product.id,
            productName: product.name,
            marketplaceId: marketplace.id,
            status: "error",
            errorMessage: `API direta para ${marketplace.name} ainda não disponível.`,
          });
        }
      } catch (error: any) {
        errorCount++;
        await addLogMutation.mutateAsync({
          jobId,
          productId: product.id,
          productName: product.name,
          marketplaceId: marketplace.id,
          status: "error",
          errorMessage: error.message,
        });
        toast.error(`Erro em "${product.name.substring(0, 30)}...": ${error.message}`, { duration: 3000 });
      }

      setExportProgress(Math.round(((i + 1) / totalTasks) * 100));
      await updateExportMutation.mutateAsync({
        jobId,
        processedProducts: i + 1,
        successCount,
        errorCount,
      });

      // Small delay between API calls to avoid rate limiting
      if (i < pubTasks.length - 1) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    await updateExportMutation.mutateAsync({
      jobId,
      status: errorCount === totalTasks ? "failed" : "completed",
    });

    setStep("done");
    toast.success(`Exportação concluída! ${successCount} publicados, ${errorCount} erros (de ${totalTasks} anúncios).`);
  };

  const updateProductAttribute = (productId: string, attrIndex: number, newValue: string) => {
    setMappedProducts((prev) =>
      prev.map((p) => {
        if (p.id !== productId || !p.suggestedAttributes) return p;
        const newAttrs = [...p.suggestedAttributes];
        newAttrs[attrIndex] = { ...newAttrs[attrIndex], value: newValue };
        return { ...p, suggestedAttributes: newAttrs };
      })
    );
  };

  const getMarketplaceDisplayName = () => {
    if (!selectedMarketplaceInfo) return "Marketplace";
    return (selectedMarketplaceInfo as any).name || "Marketplace";
  };

  // ===== RENDER PRODUCT CARD (REVIEW STEP) =====
  const renderProductCard = (product: MappedProduct, index: number) => {
    const isExpanded = expandedProducts.has(product.id);
    const isEditing = editingProduct === product.id;
    const isLoadingImages = loadingImagesFor.has(product.id);
    const isLoadingAttrs = loadingAttrsFor.has(product.id);
    const coverIdx = product.coverImageIndex || 0;
    const displayImage = product.allImages?.[coverIdx] || product.imageUrl;
    const imageCount = product.allImages?.length || (product.imageUrl ? 1 : 0);
    const listingTypeInfo = LISTING_TYPE_OPTIONS.find(o => o.value === (product.listingType || selectedListingTypes[0]));

    return (
      <Card key={product.id} className={`overflow-hidden transition-all ${
        product.status === "error" ? "border-destructive/50" :
        product.status === "mapped" ? "border-green-200" : "border-amber-200"
      } ${!product.selected ? "opacity-60" : ""}`}>
        <CardContent className="p-0">
          {/* Header row with checkbox, image, title, and quick actions */}
          <div className="flex items-start gap-3 p-4 pb-3">
            {/* Checkbox */}
            <div className="pt-1 shrink-0">
              <Checkbox
                checked={product.selected !== false}
                onCheckedChange={() => toggleSelectProduct(product.id)}
              />
            </div>

            {/* Cover image with gallery indicator */}
            <div className="relative shrink-0 group">
              {displayImage ? (
                <img
                  src={displayImage}
                  alt={product.name}
                  className="h-20 w-20 rounded-lg object-cover border shadow-sm cursor-pointer transition-transform hover:scale-105"
                  onClick={() => toggleExpanded(product.id)}
                />
              ) : (
                <div
                  className="h-20 w-20 rounded-lg bg-muted flex items-center justify-center border cursor-pointer"
                  onClick={() => toggleExpanded(product.id)}
                >
                  <Package className="h-6 w-6 text-muted-foreground" />
                </div>
              )}
              {/* Image count badge */}
              {imageCount > 0 && (
                <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                  <ImageIcon className="h-2.5 w-2.5" />
                  {product.allImages ? product.allImages.length : "?"}
                </div>
              )}
              {/* Status indicator */}
              <div className="absolute -top-1 -left-1">
                {product.status === "mapped" && <CheckCircle className="h-4 w-4 text-green-500 bg-white rounded-full" />}
                {product.status === "error" && <XCircle className="h-4 w-4 text-destructive bg-white rounded-full" />}
                {product.status === "pending" && <AlertCircle className="h-4 w-4 text-amber-500 bg-white rounded-full" />}
              </div>
            </div>

            {/* Main content */}
            <div className="flex-1 min-w-0 space-y-1.5">
              {/* Title section */}
              <div>
                {isEditing ? (
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Título para o anúncio:</Label>
                    <Input
                      className="h-8 text-sm font-medium"
                      value={product.optimizedTitle || product.name}
                      onChange={(e) => {
                        setMappedProducts(prev => prev.map(p =>
                          p.id === product.id ? { ...p, optimizedTitle: e.target.value } : p
                        ));
                      }}
                      maxLength={60}
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] text-muted-foreground">
                        {(product.optimizedTitle || product.name).length}/60 caracteres
                      </p>
                      {product.titleReasoning && (
                        <p className="text-[10px] text-blue-600 flex items-center gap-0.5">
                          <Sparkles className="h-2.5 w-2.5" />
                          {product.titleReasoning}
                        </p>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground line-through truncate">Original: {product.name}</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-primary truncate" title={product.optimizedTitle || product.name}>
                      {product.optimizedTitle || product.name}
                    </p>
                    {product.optimizedTitle && product.optimizedTitle !== product.name && (
                      <p className="text-[10px] text-muted-foreground line-through truncate">
                        {product.name}
                      </p>
                    )}
                    {product.titleReasoning && (
                      <p className="text-[10px] text-blue-600 flex items-center gap-0.5 mt-0.5">
                        <Sparkles className="h-2.5 w-2.5" />
                        {product.titleReasoning}
                      </p>
                    )}
                    {/* Per-type titles preview */}
                    {product.titlesPerType && Object.keys(product.titlesPerType).length > 1 && (
                      <div className="mt-1 space-y-0.5">
                        {Object.entries(product.titlesPerType).map(([lt, data]) => {
                          const typeOpt = LISTING_TYPE_OPTIONS.find(o => o.value === lt);
                          return (
                            <div key={lt} className="flex items-center gap-1 text-[10px]">
                              <span className={`font-medium shrink-0 ${typeOpt?.color || ""}`}>
                                {typeOpt?.icon} {typeOpt?.label}:
                              </span>
                              <span className="truncate text-muted-foreground" title={data.title}>
                                {data.title}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Info row */}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span>ID: <strong className="text-foreground">{product.id}</strong></span>
                {product.sku && <span>SKU: <strong className="text-foreground">{product.sku}</strong></span>}
                {product.ean && <span>EAN: <strong className="text-foreground">{product.ean}</strong></span>}
                {product.mainPrice != null && product.mainPrice > 0 && (
                  <span>Preço: <strong className="text-foreground">R$ {product.mainPrice.toFixed(2)}</strong></span>
                )}
                {product.totalStock != null && (
                  <span>Estoque: <strong className="text-foreground">{product.totalStock}</strong></span>
                )}
              </div>

              {/* Category + Listing Types row */}
              <div className="flex flex-wrap items-center gap-2">
                {product.suggestedCategory && (
                  <Badge variant={product.suggestedCategory.confidence >= 80 ? "default" : "secondary"} className="text-[10px] h-5">
                    {product.suggestedCategory.confidence}% &bull; {product.suggestedCategory.name}
                  </Badge>
                )}
                {/* Show all selected listing types */}
                {selectedListingTypes.map(lt => {
                  const opt = LISTING_TYPE_OPTIONS.find(o => o.value === lt);
                  return opt ? (
                    <Badge key={lt} variant="outline" className={`text-[10px] h-5 gap-1 ${opt.color}`}>
                      {opt.icon}
                      {opt.label}
                    </Badge>
                  ) : null;
                })}
                {selectedListingTypes.length > 1 && (
                  <span className="text-[10px] text-muted-foreground">
                    ({selectedListingTypes.length} anúncios)
                  </span>
                )}
              </div>
            </div>

            {/* Right side actions */}
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setEditingProduct(isEditing ? null : product.id)}
                >
                  {isEditing ? <><Save className="h-3 w-3 mr-1" />Salvar</> : <><Edit3 className="h-3 w-3 mr-1" />Editar</>}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => toggleExpanded(product.id)}
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </div>
              {/* Quick cover image change buttons */}
              {product.allImages && product.allImages.length > 1 && (
                <div className="flex items-center gap-1 mt-1">
                  <button
                    onClick={() => setCoverImage(product.id, Math.max(0, (product.coverImageIndex || 0) - 1))}
                    disabled={(product.coverImageIndex || 0) === 0}
                    className="h-5 w-5 rounded border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="h-3 w-3" />
                  </button>
                  <span className="text-[9px] text-muted-foreground">
                    Capa {(product.coverImageIndex || 0) + 1}/{product.allImages.length}
                  </span>
                  <button
                    onClick={() => setCoverImage(product.id, Math.min(product.allImages!.length - 1, (product.coverImageIndex || 0) + 1))}
                    disabled={(product.coverImageIndex || 0) === product.allImages.length - 1}
                    className="h-5 w-5 rounded border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Error message */}
          {product.status === "error" && product.errorMessage && (
            <div className="mx-4 mb-3 p-2 rounded bg-destructive/10 border border-destructive/20">
              <p className="text-xs text-destructive">{product.errorMessage}</p>
            </div>
          )}

          {/* Expanded section: Gallery + Attributes */}
          {isExpanded && (
            <div className="border-t bg-muted/30">
              <div className="p-4 space-y-4">
                {/* Image Gallery */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <ImageIcon className="h-3.5 w-3.5" />
                      Galeria de Fotos
                      {product.allImages && <span className="text-muted-foreground font-normal">({product.allImages.length} fotos)</span>}
                    </Label>
                    <div className="flex items-center gap-1.5">
                      {!product.allImages && !isLoadingImages && (
                        <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={() => loadAllImages(product.id)}>
                          <ImagePlus className="h-3 w-3 mr-1" />
                          Carregar fotos
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] border-purple-300 text-purple-700 hover:bg-purple-50"
                        onClick={() => handleGenerateImage(product.id)}
                        disabled={generatingImageFor.has(product.id)}
                      >
                        {generatingImageFor.has(product.id) ? (
                          <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Gerando...</>
                        ) : (
                          <><Wand2 className="h-3 w-3 mr-1" />Gerar Foto IA</>
                        )}
                      </Button>
                    </div>
                  </div>

                  {isLoadingImages ? (
                    <div className="flex gap-2">
                      {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-20 rounded-lg" />)}
                    </div>
                  ) : product.allImages && product.allImages.length > 0 ? (
                    <div className="flex gap-2 flex-wrap">
                      {product.allImages.map((img, idx) => (
                        <button
                          key={idx}
                          onClick={() => setCoverImage(product.id, idx)}
                          className={`relative h-20 w-20 rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                            idx === (product.coverImageIndex || 0)
                              ? "border-primary ring-2 ring-primary/30 shadow-md"
                              : "border-border hover:border-primary/40"
                          }`}
                        >
                          <img src={img} alt={`Foto ${idx + 1}`} className="h-full w-full object-cover" />
                          {idx === (product.coverImageIndex || 0) && (
                            <div className="absolute top-0.5 left-0.5 bg-primary text-primary-foreground text-[8px] px-1 py-0.5 rounded font-bold">
                              CAPA
                            </div>
                          )}
                          <div className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[8px] px-1 rounded">
                            {idx + 1}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 py-4">
                      <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                      <p className="text-xs text-muted-foreground italic">Nenhuma foto disponível</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-50"
                        onClick={() => handleGenerateImage(product.id)}
                        disabled={generatingImageFor.has(product.id)}
                      >
                        {generatingImageFor.has(product.id) ? (
                          <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />Gerando foto com IA...</>
                        ) : (
                          <><Wand2 className="h-3.5 w-3.5 mr-1" />Gerar Foto com IA</>
                        )}
                      </Button>
                    </div>
                  )}

                  {/* AI Image Generation Style Selector */}
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-muted-foreground">Estilo IA:</span>
                    {([
                      { value: "white_background", label: "Fundo Branco" },
                      { value: "lifestyle", label: "Lifestyle" },
                      { value: "enhanced", label: "Melhorada" },
                      { value: "product_photo", label: "Produto" },
                    ] as const).map(s => (
                      <button
                        key={s.value}
                        onClick={() => setImageGenStyle(s.value)}
                        className={`text-[9px] px-1.5 py-0.5 rounded border transition-all ${
                          imageGenStyle === s.value
                            ? "bg-purple-100 border-purple-400 text-purple-700 font-medium"
                            : "border-transparent text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Separator />

                {/* Description section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      Descrição do Produto
                      {product.description && (
                        <span className="text-muted-foreground font-normal">({product.description.length} caracteres)</span>
                      )}
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <select
                        className="h-6 text-[10px] border rounded px-1.5 bg-background"
                        value={descriptionStyle}
                        onChange={(e) => setDescriptionStyle(e.target.value as any)}
                      >
                        <option value="seo">SEO</option>
                        <option value="detailed">Detalhada</option>
                        <option value="short">Curta</option>
                      </select>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => handleGenerateDescription(product.id)}
                        disabled={generatingDescFor.has(product.id)}
                      >
                        {generatingDescFor.has(product.id) ? (
                          <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Gerando...</>
                        ) : (
                          <><Sparkles className="h-3 w-3 mr-1" />Gerar Descrição IA</>
                        )}
                      </Button>
                    </div>
                  </div>

                  {isEditing ? (
                    <Textarea
                      className="text-xs min-h-[120px] resize-y"
                      value={product.description || ""}
                      onChange={(e) => {
                        setMappedProducts(prev => prev.map(p =>
                          p.id === product.id ? { ...p, description: e.target.value } : p
                        ));
                      }}
                      placeholder="Descrição do produto para o anúncio..."
                    />
                  ) : (
                    <div className="bg-background rounded-lg border p-3 max-h-[200px] overflow-y-auto">
                      {product.description ? (
                        <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                          {product.description.length > 500 ? product.description.substring(0, 500) + "..." : product.description}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">Sem descrição. Clique em "Gerar Descrição IA" ou "Editar" para adicionar.</p>
                      )}
                    </div>
                  )}
                </div>

                <Separator />

                {/* Attributes section */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-semibold flex items-center gap-1.5">
                      <Settings2 className="h-3.5 w-3.5" />
                      Atributos do Produto
                    </Label>
                    {product.suggestedCategory?.id && !product.mlCategoryAttributes && !isLoadingAttrs && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px]"
                        onClick={() => loadCategoryAttributes(product.id, product.suggestedCategory!.id)}
                      >
                        Buscar atributos ML
                      </Button>
                    )}
                  </div>

                  {isLoadingAttrs ? (
                    <div className="space-y-2">
                      {[1,2,3].map(i => <Skeleton key={i} className="h-6 w-full rounded" />)}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Required attributes */}
                      {(() => {
                        const requiredAttrs = (product.suggestedAttributes || []).filter((a: any) => a.required !== false);
                        if (requiredAttrs.length === 0) return null;
                        return (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide">Obrigatórios</p>
                            {requiredAttrs.map((attr: any) => {
                              const origIdx = (product.suggestedAttributes || []).indexOf(attr);
                              return isEditing ? (
                                <div key={origIdx} className="flex items-center gap-1.5">
                                  <span className="text-[11px] font-medium text-red-600 w-20 shrink-0 truncate" title={attr.attributeName}>
                                    {attr.attributeName}*
                                  </span>
                                  <Input
                                    className="h-6 text-xs border-red-200 focus:border-red-400"
                                    value={attr.value}
                                    onChange={(e) => updateProductAttribute(product.id, origIdx, e.target.value)}
                                  />
                                </div>
                              ) : (
                                <p key={origIdx} className="text-xs">
                                  <span className="text-red-600 font-medium">{attr.attributeName}*:</span>{" "}
                                  {attr.value || <span className="text-red-400 italic">vazio</span>}
                                </p>
                              );
                            })}
                          </div>
                        );
                      })()}

                      {/* Optional attributes */}
                      {(() => {
                        const optionalAttrs = (product.suggestedAttributes || []).filter((a: any) => a.required === false);
                        if (optionalAttrs.length === 0) return null;
                        return (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Opcionais</p>
                            {(isEditing ? optionalAttrs : optionalAttrs.slice(0, 6)).map((attr: any) => {
                              const origIdx = (product.suggestedAttributes || []).indexOf(attr);
                              return isEditing ? (
                                <div key={origIdx} className="flex items-center gap-1.5">
                                  <span className="text-[11px] text-muted-foreground w-20 shrink-0 truncate" title={attr.attributeName}>
                                    {attr.attributeName}
                                  </span>
                                  <Input
                                    className="h-6 text-xs"
                                    value={attr.value}
                                    onChange={(e) => updateProductAttribute(product.id, origIdx, e.target.value)}
                                  />
                                </div>
                              ) : (
                                <p key={origIdx} className="text-xs">
                                  <span className="text-muted-foreground">{attr.attributeName}:</span> {attr.value || "—"}
                                </p>
                              );
                            })}
                            {!isEditing && optionalAttrs.length > 6 && (
                              <p className="text-[10px] text-muted-foreground">+{optionalAttrs.length - 6} mais</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* ML Category Attributes (from API) */}
                  {product.mlCategoryAttributes && product.mlCategoryAttributes.length > 0 && (
                    <Collapsible className="mt-3">
                      <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-800 font-medium">
                        <ChevronDown className="h-3 w-3" />
                        Atributos da categoria ML ({product.mlCategoryAttributes.filter(a => a.required).length} obrigatórios, {product.mlCategoryAttributes.filter(a => !a.required).length} opcionais)
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2">
                        <div className="bg-blue-50/50 rounded-lg p-3 border border-blue-100">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            {product.mlCategoryAttributes
                              .filter(a => a.required)
                              .slice(0, 20)
                              .map((attr, idx) => (
                                <div key={idx} className="flex items-center gap-1">
                                  <span className="text-red-600 font-medium truncate flex-1" title={attr.name}>
                                    {attr.name}*
                                  </span>
                                  {attr.values.length > 0 && (
                                    <Badge variant="outline" className="text-[8px] h-4 shrink-0">
                                      {attr.values.length} opções
                                    </Badge>
                                  )}
                                </div>
                              ))}
                          </div>
                          {product.mlCategoryAttributes.filter(a => a.required).length > 20 && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              +{product.mlCategoryAttributes.filter(a => a.required).length - 20} mais atributos obrigatórios
                            </p>
                          )}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Exportar Produtos</h1>
        <p className="text-muted-foreground">
          Exporte produtos do BaseLinker diretamente para marketplaces via API
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { key: "select", label: "Selecionar", num: 1 },
          { key: "mapping", label: "Mapeamento IA", num: 2 },
          { key: "review", label: "Revisar", num: 3 },
          { key: "exporting", label: "Publicando", num: 4 },
          { key: "done", label: "Concluído", num: 5 },
        ].map((s, idx) => (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-medium ${
                step === s.key
                  ? "bg-primary text-primary-foreground"
                  : ["select", "mapping", "review", "exporting", "done"].indexOf(step) >
                    ["select", "mapping", "review", "exporting", "done"].indexOf(s.key)
                  ? "bg-green-500 text-white"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {s.num}
            </div>
            <span className={step === s.key ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
            {idx < 4 && <ArrowRight className="h-3 w-3 text-muted-foreground" />}
          </div>
        ))}
      </div>

      {/* Step: Select */}
      {step === "select" && (
        <div className="space-y-4">
          {/* Products loaded from Products page */}
          {isLoadingProducts && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  <span className="text-sm">
                    {reExportJobId
                      ? `Carregando produtos do Job #${reExportJobId} para re-exportação...`
                      : `Carregando ${preSelectedIds.length} produtos selecionados...`
                    }
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {mappedProducts.length > 0 && (
            <Card className="border-green-500/30 bg-green-50">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="text-sm font-medium text-green-800">
                      {mappedProducts.length} produto(s) carregado(s) para exportação
                      {reExportJobId && (
                        <Badge variant="outline" className="ml-2 text-xs border-green-500 text-green-700">
                          Re-exportação do Job #{reExportJobId}
                        </Badge>
                      )}
                    </p>
                    {preSelectedTag && preSelectedTag !== "all" && (
                      <p className="text-xs text-green-600 mt-0.5">
                        Tag: {preSelectedTag}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-green-700"
                    onClick={() => {
                      setMappedProducts([]);
                      setPreSelectedIds([]);
                      setLocation("/products");
                    }}
                  >
                    Alterar seleção
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {mappedProducts.length === 0 && !isLoadingProducts && (
            <Card className="border-dashed border-amber-300 bg-amber-50/50">
              <CardContent className="flex flex-col items-center justify-center py-8 gap-3">
                <Info className="h-8 w-8 text-amber-500" />
                <p className="text-sm text-amber-700 text-center">
                  Nenhum produto selecionado. Vá para a página de <strong>Produtos</strong>, selecione os produtos desejados e clique em <strong>"Exportar"</strong>.
                </p>
                <Button variant="outline" onClick={() => setLocation("/products")}>
                  <Package className="mr-2 h-4 w-4" />
                  Ir para Produtos
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Product preview table */}
          {mappedProducts.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  Produtos para Exportação ({mappedProducts.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-[300px] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-12">#</TableHead>
                        <TableHead className="w-14">Foto</TableHead>
                        <TableHead>Nome</TableHead>
                        <TableHead>SKU</TableHead>
                        <TableHead>EAN</TableHead>
                        <TableHead className="text-right">Preço</TableHead>
                        <TableHead className="text-right">Estoque</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {mappedProducts.slice(0, 20).map((p, idx) => (
                        <TableRow key={p.id}>
                          <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                          <TableCell>
                            {p.imageUrl ? (
                              <img src={p.imageUrl} alt={p.name} className="h-10 w-10 rounded-md object-cover border" />
                            ) : (
                              <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center">
                                <Package className="h-4 w-4 text-muted-foreground" />
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <p className="text-sm font-medium truncate max-w-[300px]">{p.name}</p>
                            <p className="text-xs text-muted-foreground">ID: {p.id}</p>
                          </TableCell>
                          <TableCell className="text-xs">{p.sku || "—"}</TableCell>
                          <TableCell className="text-xs">{p.ean || "—"}</TableCell>
                          <TableCell className="text-right text-sm">
                            {p.mainPrice ? `R$ ${p.mainPrice.toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell className="text-right text-sm">{p.totalStock ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                      {mappedProducts.length > 20 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-xs text-muted-foreground py-2">
                            ... e mais {mappedProducts.length - 20} produto(s)
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Marketplace + Account selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="h-4 w-4" />
                Marketplace de Destino
              </CardTitle>
              <CardDescription>Selecione o marketplace e a conta conectada para publicar diretamente</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Marketplace selection - Visual cards with logos */}
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                {(marketplaces || []).map((mp: any) => {
                  const isSelected = selectedMarketplace === String(mp.id);
                  const mpCode = mp.code?.toLowerCase();
                  const accountTypes = MARKETPLACE_CODE_TO_ACCOUNT_TYPE[mpCode];
                  const hasApi = accountTypes && accountTypes.length > 0;
                  return (
                    <button
                      key={mp.id}
                      onClick={() => {
                        setSelectedMarketplace(String(mp.id));
                        setSelectedAccount("");
                      }}
                      className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all duration-200 hover:shadow-md cursor-pointer ${
                        isSelected
                          ? "border-primary bg-primary/5 shadow-md ring-2 ring-primary/20"
                          : "border-border hover:border-primary/40 bg-card"
                      }`}
                    >
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5">
                          <CheckCircle className="h-4 w-4 text-primary" />
                        </div>
                      )}
                      {hasApi && (
                        <div className="absolute top-1.5 left-1.5">
                          <Badge variant="default" className="text-[8px] h-4 px-1 bg-green-600">API</Badge>
                        </div>
                      )}
                      <div className="h-10 w-10 rounded-lg bg-muted/50 flex items-center justify-center overflow-hidden">
                        {mp.icon ? (
                          <img src={mp.icon} alt={mp.name} className="h-8 w-8 object-contain" />
                        ) : (
                          <Store className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                      <span className={`text-xs font-medium text-center leading-tight ${
                        isSelected ? "text-primary" : "text-foreground"
                      }`}>
                        {mp.name}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Account selection - from our connected accounts (NOT BaseLinker) */}
              {selectedMarketplace && (
                <div className="space-y-3 pt-2 border-t">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Link2 className="h-3.5 w-3.5" />
                      Conta Conectada
                      {selectedMarketplaceInfo && (
                        <Badge variant="secondary" className="text-[10px] h-5 gap-1">
                          {(selectedMarketplaceInfo as any).icon && (
                            <img src={(selectedMarketplaceInfo as any).icon} alt="" className="h-3 w-3 object-contain" />
                          )}
                          {(selectedMarketplaceInfo as any).name}
                        </Badge>
                      )}
                    </label>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        refetchMlAccounts();
                        refetchTiktokAccounts();
                      }}
                    >
                      <RefreshCw className="h-3 w-3 mr-1" />
                      Atualizar
                    </Button>
                  </div>

                  {!hasDirectApiSupport ? (
                    <div className="flex flex-col items-center gap-3 p-6 rounded-lg bg-amber-50 border border-amber-200">
                      <AlertCircle className="h-8 w-8 text-amber-500" />
                      <div className="text-center">
                        <p className="text-sm font-medium text-amber-800">
                          API direta para {getMarketplaceDisplayName()} ainda não disponível
                        </p>
                        <p className="text-xs text-amber-600 mt-1">
                          Atualmente suportamos exportação direta via API para: <strong>Mercado Livre</strong> e <strong>TikTok Shop</strong>.
                          Outros marketplaces serão adicionados em breve.
                        </p>
                      </div>
                    </div>
                  ) : filteredAccounts.length > 0 ? (
                    <div className="space-y-1.5 max-h-[250px] overflow-y-auto">
                      {filteredAccounts.map((a) => {
                        const accountKey = `${a.marketplace}:${a.id}`;
                        const isAccSelected = selectedAccount === accountKey;
                        return (
                          <button
                            key={accountKey}
                            onClick={() => setSelectedAccount(accountKey)}
                            className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                              isAccSelected
                                ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                                : "border-border hover:border-primary/30 hover:bg-muted/30"
                            }`}
                          >
                            <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                              isAccSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                            }`}>
                              {isAccSelected ? (
                                <CheckCircle className="h-4 w-4" />
                              ) : (
                                <Store className="h-4 w-4" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-medium truncate ${
                                isAccSelected ? "text-primary" : ""
                              }`}>
                                {a.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {a.marketplace === "mercadolivre" ? "Mercado Livre" : "TikTok Shop"} &bull; Conta #{a.id}
                              </p>
                            </div>
                            <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200 shrink-0">
                              API Direta
                            </Badge>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-3 p-6 rounded-lg bg-blue-50 border border-blue-200">
                      <Info className="h-8 w-8 text-blue-500" />
                      <div className="text-center">
                        <p className="text-sm font-medium text-blue-800">
                          Nenhuma conta {getMarketplaceDisplayName()} conectada
                        </p>
                        <p className="text-xs text-blue-600 mt-1">
                          Conecte uma conta na página de contas do marketplace para publicar diretamente.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const mpCode = (selectedMarketplaceInfo as any)?.code?.toLowerCase();
                          if (mpCode === "mercadolivre") setLocation("/ml-accounts");
                          else if (mpCode === "tiktok") setLocation("/tiktok-accounts");
                        }}
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        Conectar Conta
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {/* Info about direct export */}
              {selectedAccount && selectedAccountInfo && (
                <div className="p-3 rounded-lg bg-green-50 border border-green-200 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                  <p className="text-xs text-green-700">
                    <strong>Exportação direta via API ativada!</strong> Os produtos serão publicados diretamente no {getMarketplaceDisplayName()} usando a conta <strong>{selectedAccountInfo.name}</strong>, sem intermediários.
                  </p>
                </div>
              )}

              {/* Info about re-export skip mapping */}
              {canSkipMapping && hasPreviousMappedData && (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 text-blue-500 shrink-0" />
                  <p className="text-xs text-blue-700">
                    <strong>Re-exportação para mesmo marketplace detectada.</strong> O mapeamento anterior (categorias e atributos) será reutilizado automaticamente.
                  </p>
                </div>
              )}

              <Button
                onClick={handleStartMapping}
                disabled={!selectedMarketplace || !selectedAccount || mappedProducts.length === 0 || isMappingInProgress}
                className="w-full"
                size="lg"
              >
                {canSkipMapping && hasPreviousMappedData ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Reutilizar Mapeamento e Continuar ({mappedProducts.length} produtos)
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Iniciar Mapeamento com IA ({mappedProducts.length} produtos)
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step: Mapping */}
      {step === "mapping" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Mapeamento com IA em Progresso
            </CardTitle>
            <CardDescription>
              A IA está analisando cada produto para sugerir categorias e preencher fichas técnicas
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={mappingProgress} className="h-3" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{mappingProgress}% concluído</span>
              <span>
                {mappedProducts.filter((p) => p.status !== "pending").length} de {mappedProducts.length} produtos
              </span>
            </div>
            <div className="max-h-[400px] overflow-y-auto space-y-2">
              {mappedProducts.map((p) => (
                <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="h-8 w-8 rounded object-cover border shrink-0" />
                  ) : (
                    <div className="h-8 w-8 rounded bg-muted-foreground/10 flex items-center justify-center shrink-0">
                      <Package className="h-3 w-3 text-muted-foreground" />
                    </div>
                  )}
                  {p.status === "pending" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                  {p.status === "mapped" && <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />}
                  {p.status === "error" && <XCircle className="h-4 w-4 text-destructive shrink-0" />}
                  <span className="text-sm truncate flex-1">{p.name}</span>
                  {p.suggestedCategory && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      {p.suggestedCategory.confidence}%
                    </Badge>
                  )}
                  {p.status === "error" && (
                    <span className="text-xs text-destructive shrink-0">{p.errorMessage}</span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Review */}
      {step === "review" && (
        <div className="space-y-4">
          {/* Top bar: Back + Stats + Publish */}
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="sm" onClick={() => setStep("select")}>
                <ArrowLeft className="mr-1 h-4 w-4" />
                Voltar
              </Button>
              <Badge variant="secondary">
                {mappedProducts.filter((p) => p.status === "mapped").length} mapeado(s)
              </Badge>
              {mappedProducts.filter((p) => p.status === "error").length > 0 && (
                <Badge variant="destructive">
                  {mappedProducts.filter((p) => p.status === "error").length} erro(s)
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="text-xs text-muted-foreground hidden sm:block">
                Destino: <strong>{selectedAccountInfo?.name}</strong>
                <Badge variant="default" className="ml-2 text-[10px] bg-green-600">
                  API Direta {getMarketplaceDisplayName()}
                </Badge>
              </div>
              <Button onClick={handleExport} disabled={selectedProducts.filter(p => p.status === "mapped").length === 0}>
                <Upload className="mr-2 h-4 w-4" />
                Publicar {totalPublications} anúncio(s) no {getMarketplaceDisplayName()}
              </Button>
            </div>
          </div>

          {/* ===== BATCH ACTIONS BAR ===== */}
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="p-4">
              <div className="flex flex-col gap-4">
                {/* Row 1: Select All + Listing Type */}
                <div className="flex flex-wrap items-center gap-4">
                  {/* Select all */}
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-2 text-sm font-medium hover:text-primary transition-colors"
                  >
                    {allSelected ? (
                      <SquareCheck className="h-4 w-4 text-primary" />
                    ) : someSelected ? (
                      <div className="h-4 w-4 border-2 border-primary rounded-[3px] bg-primary/20" />
                    ) : (
                      <Square className="h-4 w-4 text-muted-foreground" />
                    )}
                    {allSelected ? "Desmarcar todos" : "Selecionar todos"}
                    <Badge variant="outline" className="text-[10px] h-5">
                      {selectedProducts.length}/{mappedProducts.length}
                    </Badge>
                  </button>

                  <Separator orientation="vertical" className="h-6" />

                  {/* Batch listing type */}
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium flex items-center gap-1 whitespace-nowrap">
                      <Crown className="h-3.5 w-3.5" />
                      Tipo de Anúncio:
                    </Label>
                    <div className="flex gap-1">
                      {LISTING_TYPE_OPTIONS.map(opt => {
                        const isActive = selectedListingTypes.includes(opt.value);
                        return (
                          <Button
                            key={opt.value}
                            variant={isActive ? "default" : "outline"}
                            size="sm"
                            className={`h-7 text-[11px] gap-1 ${!isActive ? opt.color : ""}`}
                            onClick={() => toggleListingType(opt.value)}
                          >
                            {opt.icon}
                            {opt.label}
                            {isActive && <CheckCircle className="h-3 w-3 ml-0.5" />}
                          </Button>
                        );
                      })}
                    </div>
                    <Tooltip>
                      <TooltipTrigger>
                        <Info className="h-3.5 w-3.5 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <p className="text-xs">Selecione até 3 tipos de anúncio. Cada produto será publicado uma vez para cada tipo selecionado.</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Total publications info */}
                  {selectedListingTypes.length > 1 && (
                    <div className="flex items-center gap-1.5 text-xs bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-md border border-blue-200 dark:border-blue-800">
                      <Info className="h-3 w-3 shrink-0" />
                      <span>
                        <strong>{selectedProducts.filter(p => p.status === "mapped").length}</strong> produtos ×{" "}
                        <strong>{selectedListingTypes.length}</strong> tipos ={" "}
                        <strong>{totalPublications}</strong> anúncios
                      </span>
                    </div>
                  )}
                </div>

                {/* Row 2: Title Generation */}
                <div className="flex flex-wrap items-end gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium flex items-center gap-1 whitespace-nowrap">
                      <Type className="h-3.5 w-3.5" />
                      Gerar Títulos:
                    </Label>
                    <Select value={batchTitleStyle} onValueChange={setBatchTitleStyle}>
                      <SelectTrigger className="h-7 text-[11px] w-36">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TITLE_STYLE_OPTIONS.map(opt => (
                          <SelectItem key={opt.value} value={opt.value} className="text-xs">
                            <div>
                              <span className="font-medium">{opt.label}</span>
                              <span className="text-muted-foreground ml-1">— {opt.description}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {batchTitleStyle === "custom" && (
                    <Input
                      className="h-7 text-xs flex-1 min-w-[200px]"
                      placeholder="Ex: Incluir marca e modelo, máximo 60 caracteres..."
                      value={customTitleInstruction}
                      onChange={(e) => setCustomTitleInstruction(e.target.value)}
                    />
                  )}

                  <Button
                    variant="default"
                    size="sm"
                    className="h-7 text-[11px] gap-1"
                    onClick={handleBatchGenerateTitles}
                    disabled={isGeneratingTitles || selectedProducts.filter(p => p.status === "mapped").length === 0}
                  >
                    {isGeneratingTitles ? (
                      <><Loader2 className="h-3 w-3 animate-spin" />{titleGenProgress > 0 ? `${titleGenProgress}%` : "Gerando..."}</>
                    ) : (
                      <><Wand2 className="h-3 w-3" />Gerar Títulos ({selectedProducts.filter(p => p.status === "mapped").length})</>
                    )}
                  </Button>

                  {/* Title per type toggle - only show when multiple types selected */}
                  {selectedListingTypes.length > 1 && (
                    <div className="flex items-center gap-2 ml-2">
                      <Switch
                        id="titlePerType"
                        checked={titlePerType}
                        onCheckedChange={setTitlePerType}
                        className="scale-75"
                      />
                      <Label htmlFor="titlePerType" className="text-[11px] text-muted-foreground cursor-pointer">
                        Título diferente por tipo
                      </Label>
                      <Tooltip>
                        <TooltipTrigger>
                          <Info className="h-3 w-3 text-muted-foreground" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p className="text-xs">Quando ativado, gera um título otimizado para cada tipo de anúncio (ex: título curto para Grátis, completo para Premium).</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                </div>

                {/* Row 3: Image Generation in Batch */}
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs font-medium flex items-center gap-1 whitespace-nowrap">
                      <Images className="h-3.5 w-3.5" />
                      Gerar Fotos IA:
                    </Label>
                    <div className="flex gap-1">
                      {([
                        { value: "white_background" as const, label: "Fundo Branco" },
                        { value: "lifestyle" as const, label: "Lifestyle" },
                        { value: "enhanced" as const, label: "Melhorada" },
                        { value: "product_photo" as const, label: "Produto" },
                      ]).map(s => (
                        <button
                          key={s.value}
                          onClick={() => setImageGenStyle(s.value)}
                          className={`text-[10px] px-2 py-1 rounded border transition-all ${
                            imageGenStyle === s.value
                              ? "bg-purple-100 border-purple-400 text-purple-700 font-medium"
                              : "border-border text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-[11px] gap-1 border-purple-300 text-purple-700 hover:bg-purple-50"
                    onClick={handleBatchGenerateImages}
                    disabled={isBatchGeneratingImages || selectedProducts.filter(p => p.status === "mapped").length === 0}
                  >
                    {isBatchGeneratingImages ? (
                      <><Loader2 className="h-3 w-3 animate-spin" />{batchImageGenProgress > 0 ? `${batchImageGenProgress}%` : "Gerando..."}</>
                    ) : (
                      <><Wand2 className="h-3 w-3" />Gerar Fotos ({selectedProducts.filter(p => p.status === "mapped").length})</>
                    )}
                  </Button>

                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3.5 w-3.5 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <p className="text-xs">Gera uma foto com IA para cada produto selecionado e define como foto de capa. A foto original é usada como referência.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Product review cards */}
          <div className="space-y-3">
            {mappedProducts.map((product, index) => renderProductCard(product, index))}
          </div>

          {/* Bottom publish button */}
          {mappedProducts.length > 5 && (
            <div className="flex justify-end">
              <Button onClick={handleExport} disabled={selectedProducts.filter(p => p.status === "mapped").length === 0} size="lg">
                <Upload className="mr-2 h-4 w-4" />
                Publicar {totalPublications} anúncio(s) no {getMarketplaceDisplayName()}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Step: Exporting */}
      {step === "exporting" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary animate-pulse" />
              Publicando Produtos no {getMarketplaceDisplayName()}...
            </CardTitle>
            <CardDescription>
              Os produtos estão sendo publicados diretamente via API na conta{" "}
              <strong>{selectedAccountInfo?.name}</strong>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={exportProgress} className="h-3" />
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>{exportProgress}% concluído</span>
              <span>
                {Math.round((exportProgress / 100) * totalPublications)} de {totalPublications} anúncio(s)
                {selectedListingTypes.length > 1 && (
                  <span className="ml-1">({selectedProducts.filter(p => p.status === "mapped").length} produtos × {selectedListingTypes.length} tipos)</span>
                )}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step: Done */}
      {step === "done" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
            <div className="h-16 w-16 rounded-full bg-green-100 dark:bg-green-950 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-xl font-semibold">Publicação Concluída!</h3>
            <p className="text-sm text-muted-foreground">
              Publicado diretamente no {getMarketplaceDisplayName()} via API — conta: <strong>{selectedAccountInfo?.name}</strong>
            </p>
            <div className="flex items-center gap-4">
              <Badge variant="default" className="text-sm">
                {mappedProducts.filter((p) => p.status === "mapped" && p.selected !== false).length} publicado(s)
              </Badge>
              <Badge variant="destructive" className="text-sm">
                {mappedProducts.filter((p) => p.status === "error").length} erro(s)
              </Badge>
            </div>
            <div className="flex gap-3 mt-4">
              <Button variant="outline" onClick={() => setLocation("/logs")}>
                Ver Logs Detalhados
              </Button>
              <Button
                onClick={() => {
                  setStep("select");
                  setMappedProducts([]);
                  setPreSelectedIds([]);
                  setPreSelectedTag("");
                  setExportJobId(null);
                  setSelectedAccount("");
                  setLocation("/products");
                }}
              >
                Nova Exportação
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
