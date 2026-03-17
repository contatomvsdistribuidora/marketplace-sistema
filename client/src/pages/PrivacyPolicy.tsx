import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="mb-8">
          <Link href="/">
            <Button variant="ghost" size="sm" className="gap-2 mb-4">
              <ArrowLeft className="h-4 w-4" />
              Voltar ao início
            </Button>
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Política de Privacidade</h1>
          <p className="text-gray-500 mt-2">Última atualização: 17 de março de 2026</p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border p-8 space-y-8 text-gray-700 leading-relaxed">
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">1. Introdução</h2>
            <p>
              A Exonex ("nós", "nosso" ou "plataforma") é uma plataforma de gerenciamento e exportação de produtos
              para múltiplos marketplaces. Esta Política de Privacidade descreve como coletamos, usamos, armazenamos
              e protegemos suas informações pessoais quando você utiliza nossos serviços.
            </p>
            <p className="mt-2">
              Ao utilizar a Exonex, você concorda com as práticas descritas nesta política. Recomendamos a leitura
              completa deste documento.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">2. Dados que Coletamos</h2>
            <p>Coletamos os seguintes tipos de informações:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Dados de cadastro:</strong> nome, endereço de e-mail e senha (armazenada de forma criptografada com bcrypt).</li>
              <li><strong>Dados de integração:</strong> tokens de acesso OAuth de marketplaces (Mercado Livre, TikTok Shop e outros) necessários para operar em seu nome.</li>
              <li><strong>Dados de produtos:</strong> informações de produtos importados do BaseLinker, incluindo nome, descrição, preço, estoque, imagens e categorias.</li>
              <li><strong>Dados de uso:</strong> registros de atividades na plataforma, como exportações realizadas, logs de erros e histórico de operações.</li>
              <li><strong>Dados técnicos:</strong> endereço IP, tipo de navegador e informações de sessão para fins de segurança e melhoria do serviço.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">3. Como Utilizamos seus Dados</h2>
            <p>Utilizamos suas informações para:</p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Fornecer e manter nossos serviços de exportação de produtos para marketplaces.</li>
              <li>Autenticar sua identidade e proteger sua conta.</li>
              <li>Conectar-se aos marketplaces em seu nome via OAuth para criar e gerenciar anúncios.</li>
              <li>Mapear categorias e preencher fichas técnicas utilizando inteligência artificial.</li>
              <li>Enviar notificações sobre o status de suas exportações e operações.</li>
              <li>Melhorar a qualidade e a segurança da plataforma.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">4. Armazenamento e Segurança dos Dados</h2>
            <p>
              Adotamos medidas técnicas e organizacionais adequadas para proteger seus dados pessoais contra acesso
              não autorizado, alteração, divulgação ou destruição. Entre as medidas implementadas:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li>Criptografia de senhas com algoritmo bcrypt.</li>
              <li>Comunicação criptografada via HTTPS/TLS em todas as transmissões de dados.</li>
              <li>Tokens de acesso a marketplaces armazenados de forma segura no banco de dados.</li>
              <li>Controle de acesso baseado em funções (RBAC) para restringir o acesso a dados sensíveis.</li>
              <li>Autenticação via JWT (JSON Web Tokens) com expiração configurada.</li>
            </ul>
            <p className="mt-2">
              Os dados são armazenados em servidores seguros localizados nos Estados Unidos, com infraestrutura
              de nuvem que implementa segregação de rede, firewalls e monitoramento contínuo.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">5. Compartilhamento de Dados</h2>
            <p>
              Não vendemos, alugamos ou compartilhamos suas informações pessoais com terceiros, exceto nas
              seguintes situações:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Marketplaces:</strong> compartilhamos dados de produtos com os marketplaces que você autorizou (Mercado Livre, TikTok Shop, etc.) para criar e gerenciar anúncios.</li>
              <li><strong>BaseLinker:</strong> acessamos dados de produtos da sua conta BaseLinker conforme sua autorização via token de API.</li>
              <li><strong>Obrigação legal:</strong> quando exigido por lei, regulamento ou ordem judicial.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">6. Seus Direitos (LGPD)</h2>
            <p>
              Em conformidade com a Lei Geral de Proteção de Dados (LGPD - Lei nº 13.709/2018), você tem os
              seguintes direitos:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>Acesso:</strong> solicitar informações sobre quais dados pessoais possuímos sobre você.</li>
              <li><strong>Correção:</strong> solicitar a correção de dados incompletos, inexatos ou desatualizados.</li>
              <li><strong>Exclusão:</strong> solicitar a eliminação dos seus dados pessoais.</li>
              <li><strong>Portabilidade:</strong> solicitar a transferência dos seus dados para outro fornecedor de serviço.</li>
              <li><strong>Revogação do consentimento:</strong> revogar o consentimento para o tratamento dos seus dados a qualquer momento.</li>
              <li><strong>Oposição:</strong> opor-se ao tratamento de dados quando realizado com base em hipótese diferente do consentimento.</li>
            </ul>
            <p className="mt-2">
              Para exercer qualquer um desses direitos, entre em contato conosco pelo e-mail indicado na seção de contato.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">7. Retenção de Dados</h2>
            <p>
              Mantemos seus dados pessoais apenas pelo tempo necessário para cumprir as finalidades para as quais
              foram coletados. Ao encerrar sua conta ou ao final da relação contratual, seus dados pessoais serão
              excluídos de nossos sistemas em até 30 dias, salvo obrigação legal de retenção.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">8. Cookies e Tecnologias Similares</h2>
            <p>
              Utilizamos cookies essenciais para manter sua sessão autenticada e garantir o funcionamento adequado
              da plataforma. Não utilizamos cookies de rastreamento ou publicidade de terceiros.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">9. Alterações nesta Política</h2>
            <p>
              Podemos atualizar esta Política de Privacidade periodicamente. Quaisquer alterações serão publicadas
              nesta página com a data de atualização revisada. Recomendamos que você revise esta política
              regularmente.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-3">10. Contato</h2>
            <p>
              Se você tiver dúvidas sobre esta Política de Privacidade ou sobre o tratamento dos seus dados
              pessoais, entre em contato conosco:
            </p>
            <ul className="list-disc pl-6 mt-2 space-y-1">
              <li><strong>E-mail:</strong> contato.mvsdistribuidora@gmail.com</li>
              <li><strong>Responsável pela Proteção de Dados (DPO):</strong> contato.mvsdistribuidora@gmail.com</li>
            </ul>
          </section>
        </div>

        <div className="mt-8 text-center text-sm text-gray-400">
          &copy; {new Date().getFullYear()} Exonex. Todos os direitos reservados.
        </div>
      </div>
    </div>
  );
}
