import { useState } from "react";
import { trpc } from "../utils/trpc";
import { Search, Package, ChevronRight, Star, Loader2, Wrench } from "lucide-react";

const PAGE_SIZE = 50;

export default function ShopeeOptimizer() {
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);

  const { data: accounts } = trpc.shopee.getAccounts.useQuery();
  const activeAccounts = accounts?.filter((a: any) => a.isActive) ?? [];

  const offset = (page - 1) * PAGE_SIZE;
  const { data: productsData, isLoading, error } = trpc.shopee.getProducts.useQuery(
    { accountId: selectedAccountId!, offset, limit: PAGE_SIZE },
    { enabled: !!selectedAccountId }
  );

  const products: any[] = productsData?.products ?? [];
  const total: number = productsData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filtered = search.trim()
    ? products.filter((p) =>
        (p.itemName ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : products;

  function handleSelectAccount(id: number) {
    setSelectedAccountId(id);
    setPage(1);
    setSearch("");
    setSelectedProduct(null);
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
          {/* Busca */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Filtrar por nome..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
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
                {search ? `${filtered.length} resultado(s) para "${search}"` : `${total} produtos`}
              </p>

              {filtered.length === 0 ? (
                <div className="text-center py-20 text-gray-400">
                  <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
                  <p>Nenhum produto encontrado</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filtered.map((product: any) => (
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
              {!search && totalPages > 1 && (
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

function ProductDetail({ product, onBack }: { product: any; onBack: () => void }) {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-500 hover:text-gray-800 mb-6 text-sm transition"
      >
        ← Voltar para lista
      </button>

      <div className="bg-white border border-gray-200 rounded-xl p-6 flex gap-4 items-start mb-6">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.itemName}
            className="w-24 h-24 object-cover rounded-lg flex-shrink-0"
          />
        ) : (
          <div className="w-24 h-24 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Package className="w-8 h-8 text-gray-400" />
          </div>
        )}
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{product.itemName || "Sem título"}</h2>
          <p className="text-sm text-gray-400 mt-1">ID: {product.itemId}</p>
          {product.price && (
            <p className="text-base font-bold text-orange-600 mt-2">
              R$ {Number(product.price).toFixed(2)}
            </p>
          )}
        </div>
      </div>

      <div className="bg-orange-50 border border-orange-200 rounded-xl p-8 text-center text-orange-700">
        <Wrench className="w-10 h-10 mx-auto mb-3 opacity-60" />
        <p className="font-semibold text-lg">Etapa 2 em construção</p>
        <p className="text-sm mt-1 opacity-70">As ferramentas de otimização serão exibidas aqui em breve.</p>
      </div>
    </div>
  );
}
