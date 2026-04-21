import { useState, useEffect } from "react";
import { trpc } from "../utils/trpc";
import {
  Search, Package, ChevronRight, Star, Loader2, Wrench,
  Plus, Trash2, Sparkles,
} from "lucide-react";

const PAGE_SIZE = 50;

export default function ShopeeOptimizer() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  // Debounce search to avoid firing on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data: accounts } = trpc.shopee.getAccounts.useQuery();
  const activeAccounts = accounts?.filter((a: any) => a.isActive) ?? [];

  const offset = (page - 1) * PAGE_SIZE;
  const { data: productsData, isLoading, error } = trpc.shopee.getProducts.useQuery(
    { accountId: selectedAccountId!, offset, limit: PAGE_SIZE, search: debouncedSearch || undefined },
    { enabled: !!selectedAccountId }
  );

  const products: any[] = productsData?.products ?? [];
  const total: number = productsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleSelectAccount(id: number) {
    setSelectedAccountId(id);
    setPage(1);
    setSearch("");
    setDebouncedSearch("");
    setSelectedProduct(null);
  }

  function handleSearchChange(val: string) {
    setSearch(val);
    setPage(1);
  }

  if (selectedProduct) {
    return <ProductDetail product={selectedProduct} onBack={() => setSelectedProduct(null)} />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Otimizar IA</h1>
        <p className="text-gray-500 mt-1">Selecione um produto para otimizar com inteligência artificial</p>
      </div>

      {/* Seletor de conta */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {activeAccounts.map((acc: any) => (
          <button
            key={acc.id}
            onClick={() => handleSelectAccount(acc.id)}
            className={`px-4 py-2 rounded-full text-sm font-medium border transition-all ${
              selectedAccountId === acc.id
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-white text-gray-700 border-gray-300 hover:border-orange-400"
            }`}
          >
            {acc.shopName || `Loja ${acc.shopId}`}
          </button>
        ))}
        {activeAccounts.length === 0 && (
          <p className="text-gray-400 text-sm">Nenhuma conta Shopee ativa</p>
        )}
      </div>

      {!selectedAccountId && (
        <div className="text-center py-20 text-gray-400">
          <Star className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>Selecione uma loja para começar</p>
        </div>
      )}

      {selectedAccountId && (
        <>
          {/* Busca server-side */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Buscar produto por nome..."
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 text-sm"
            />
          </div>

          {isLoading && (
            <div className="flex items-center justify-center py-20 gap-3 text-gray-500">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Carregando produtos...</span>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              Erro ao carregar produtos: {error.message}
            </div>
          )}

          {!isLoading && !error && (
            <>
              <p className="text-sm text-gray-500 mb-3">
                {debouncedSearch
                  ? `${total} resultado(s) para "${debouncedSearch}"`
                  : `${total} produtos`}
              </p>

              {products.length === 0 ? (
                <div className="text-center py-20 text-gray-400">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Nenhum produto encontrado</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {products.map((product: any) => (
                    <div
                      key={product.id}
                      onClick={() => setSelectedProduct(product)}
                      className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-md hover:border-orange-300 transition-all cursor-pointer"
                    >
                      <div className="flex gap-3 items-start">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt={product.itemName}
                            className="w-16 h-16 object-cover rounded-lg flex-shrink-0"
                          />
                        ) : (
                          <div className="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <Package className="w-6 h-6 text-gray-400" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 line-clamp-2 leading-snug">
                            {product.itemName || "Sem título"}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">ID: {product.itemId}</p>
                          {product.price && (
                            <p className="text-sm font-semibold text-orange-600 mt-1">
                              R$ {Number(product.price).toFixed(2)}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0 mt-1" />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Paginação */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-6">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="px-4 py-2 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-50 transition"
                  >
                    Anterior
                  </button>
                  <span className="text-sm text-gray-600">
                    Página {page} de {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="px-4 py-2 rounded-lg border text-sm disabled:opacity-40 hover:bg-gray-50 transition"
                  >
                    Próxima
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Variation {
  id: string;
  name: string;
  weight: string;
  length: string;
  width: string;
  height: string;
}

function emptyVariation(): Variation {
  return { id: crypto.randomUUID(), name: "", weight: "", length: "", width: "", height: "" };
}

// ─── Tela de detalhe ──────────────────────────────────────────────────────────

function ProductDetail({ product, onBack }: { product: any; onBack: () => void }) {
  const [variations, setVariations] = useState<Variation[]>([emptyVariation()]);

  function addVariation() {
    setVariations((v) => [...v, emptyVariation()]);
  }

  function removeVariation(id: string) {
    setVariations((v) => v.filter((x) => x.id !== id));
  }

  function updateVariation(id: string, field: keyof Omit<Variation, "id">, value: string) {
    setVariations((v) => v.map((x) => (x.id === id ? { ...x, [field]: value } : x)));
  }

  function handleGenerateAI() {
    alert("Etapa 3 em breve");
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-800 mb-6 text-sm transition"
      >
        ← Voltar para lista
      </button>

      {/* Cabeçalho do produto */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex gap-5 items-start">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt={product.itemName}
              className="w-28 h-28 object-cover rounded-xl flex-shrink-0 border border-gray-100"
            />
          ) : (
            <div className="w-28 h-28 bg-gray-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Package className="w-10 h-10 text-gray-400" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-semibold text-gray-900 leading-snug">
              {product.itemName || "Sem título"}
            </h2>
            <p className="text-xs text-gray-400 mt-1">ID: {product.itemId}</p>
            {product.price && (
              <p className="text-base font-bold text-orange-600 mt-2">
                R$ {Number(product.price).toFixed(2)}
              </p>
            )}
          </div>
        </div>

        {/* Descrição atual */}
        {product.description && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Descrição atual</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap line-clamp-6">{product.description}</p>
          </div>
        )}

        {/* Peso e medidas atuais */}
        <div className="mt-5 border-t border-gray-100 pt-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Peso e medidas atuais</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <InfoBox label="Peso" value={product.weight ? `${product.weight} kg` : "—"} />
            <InfoBox label="Comprimento" value={product.dimensionLength ? `${product.dimensionLength} cm` : "—"} />
            <InfoBox label="Largura" value={product.dimensionWidth ? `${product.dimensionWidth} cm` : "—"} />
            <InfoBox label="Altura" value={product.dimensionHeight ? `${product.dimensionHeight} cm` : "—"} />
          </div>
        </div>
      </div>

      {/* Formulário de variações */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Variações do produto</h3>
            <p className="text-xs text-gray-400 mt-0.5">Defina as variações que serão enviadas à Shopee</p>
          </div>
          <button
            onClick={addVariation}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-50 text-orange-600 text-sm font-medium hover:bg-orange-100 transition border border-orange-200"
          >
            <Plus className="w-4 h-4" />
            Adicionar variação
          </button>
        </div>

        <div className="space-y-4">
          {variations.map((v, idx) => (
            <div key={v.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Variação {idx + 1}
                </span>
                {variations.length > 1 && (
                  <button
                    onClick={() => removeVariation(v.id)}
                    className="text-red-400 hover:text-red-600 transition"
                    title="Remover variação"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">Nome da variação</label>
                  <input
                    type="text"
                    placeholder="Ex: Vermelho P, Kit com 2..."
                    value={v.name}
                    onChange={(e) => updateVariation(v.id, "name", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Peso (kg)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={v.weight}
                    onChange={(e) => updateVariation(v.id, "weight", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Comprimento (cm)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={v.length}
                    onChange={(e) => updateVariation(v.id, "length", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Largura (cm)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={v.width}
                    onChange={(e) => updateVariation(v.id, "width", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Altura (cm)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="0"
                    value={v.height}
                    onChange={(e) => updateVariation(v.id, "height", e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Botão IA */}
      <button
        onClick={handleGenerateAI}
        className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-base transition shadow-sm"
      >
        <Sparkles className="w-5 h-5" />
        Gerar otimização com IA
      </button>
    </div>
  );
}

// ─── Componente auxiliar ──────────────────────────────────────────────────────

function InfoBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-sm font-medium text-gray-800 mt-0.5">{value}</p>
    </div>
  );
}
