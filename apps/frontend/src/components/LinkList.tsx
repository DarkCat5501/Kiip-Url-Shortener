import type { Link } from '../lib/api';
import { setLinkActive, getLinks } from '../lib/api';
import { useState, useMemo, useEffect, useCallback } from 'react';
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';

interface Props {
  onSelect: (slug: string) => void;
  reloadToken: number;
}

type SortField = 'createdAt' | 'clickCount';
type SortOrder = 'asc' | 'desc';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;
const VALID_SORT_FIELDS: SortField[] = ['createdAt', 'clickCount'];

function readParamsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q') ?? '';
  const sortFieldParam = params.get('sortField');
  const sortField: SortField = VALID_SORT_FIELDS.includes(sortFieldParam as SortField)
    ? (sortFieldParam as SortField)
    : 'createdAt';
  const sortOrder: SortOrder = params.get('sortOrder') === 'asc' ? 'asc' : 'desc';
  const page = Math.max(1, Number(params.get('page')) || 1);
  return { q, sortField, sortOrder, page };
}

export function LinkList({ onSelect, reloadToken }: Props) {
  const initial = useMemo(readParamsFromUrl, []);
  const [page, setPage] = useState(initial.page);
  const [searchInput, setSearchInput] = useState(initial.q);
  const [search, setSearch] = useState(initial.q);
  const [sortField, setSortField] = useState<SortField>(initial.sortField);
  const [sortOrder, setSortOrder] = useState<SortOrder>(initial.sortOrder);

  const [links, setLinks] = useState<Link[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Debounce da busca: só atualiza `search` (e dispara fetch) após o usuário parar de digitar
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [searchInput]);

  // Reflete busca, ordenação e página na URL, substituindo a entrada atual do histórico
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (search) params.set('q', search); else params.delete('q');
    if (sortField !== 'createdAt') params.set('sortField', sortField); else params.delete('sortField');
    if (sortOrder !== 'desc') params.set('sortOrder', sortOrder); else params.delete('sortOrder');
    if (page !== 1) params.set('page', String(page)); else params.delete('page');

    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    window.history.replaceState(window.history.state, '', newUrl);
  }, [search, sortField, sortOrder, page]);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getLinks({ page, pageSize: PAGE_SIZE, q: search || undefined, sortField, sortOrder });
      setLinks(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error('Failed to load links:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, sortField, sortOrder]);

  useEffect(() => {
    loadLinks();
  }, [loadLinks, reloadToken]);

  const handleDeactivate = async (slug: string) => {
    if (!confirm('Desativar este link?')) return;
    try {
      await setLinkActive(slug, false);
      loadLinks();
    } catch (err: any) {
      alert(err.message || 'Erro ao desativar link');
    }
  };

  const handleReactivate = async (slug: string) => {
    try {
      await setLinkActive(slug, true);
      loadLinks();
    } catch (err: any) {
      alert(err.message || 'Erro ao reativar link');
    }
  };


  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setPage(1);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc'
      ? <ArrowUp size={14} style={{ verticalAlign: 'middle', marginLeft: '0.25rem' }} />
      : <ArrowDown size={14} style={{ verticalAlign: 'middle', marginLeft: '0.25rem' }} />;
  };

  if (!loading && links.length === 0 && !search) {
    return <p>Nenhum link criado ainda.</p>;
  }

  return (
    <div>
      <h2 style={{ marginBottom: '1rem' }}>Links ({total.toLocaleString('pt-BR')})</h2>

      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Filtrar por slug..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          style={{ padding: '0.5rem 0.75rem', width: '300px', border: '1px solid #ced4da', borderRadius: '6px', fontSize: '0.9rem' }}
        />
      </div>

      {loading ? (
        <p>Carregando...</p>
      ) : links.length === 0 ? (
        <p>Nenhum link encontrado para "{search}".</p>
      ) : (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #dee2e6' }}>
            <th style={{ textAlign: 'left', padding: '0.6rem 0.5rem', cursor: 'pointer', userSelect: 'none', color: '#495057' }} onClick={() => toggleSort('createdAt')}>
              Slug <SortIcon field="createdAt" />
            </th>
            <th style={{ textAlign: 'left', padding: '0.6rem 0.5rem', color: '#495057' }}>URL</th>
            <th style={{ textAlign: 'right', padding: '0.6rem 0.5rem', cursor: 'pointer', userSelect: 'none', color: '#495057' }} onClick={() => toggleSort('clickCount')}>
              Cliques <SortIcon field="clickCount" />
            </th>
            <th style={{ textAlign: 'center', padding: '0.6rem 0.5rem', color: '#495057' }}>Status</th>
            <th style={{ textAlign: 'center', padding: '0.6rem 0.5rem', color: '#495057' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => (
            <tr
              key={link.id}
              style={{ borderBottom: '1px solid #eee' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f8f9fa')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <td style={{ padding: '0.6rem 0.5rem' }}>
                <button
                  onClick={() => onSelect(link.slug)}
                  title="Ver detalhes"
                  style={{ background: 'none', border: 'none', padding: 0, color: '#007bff', cursor: 'pointer', font: 'inherit', fontWeight: 600, textDecoration: 'underline' }}
                >
                  {link.slug}
                </button>
              </td>
              <td style={{ padding: '0.6rem 0.5rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#495057' }}>
                {link.url}
              </td>
              <td style={{ textAlign: 'right', padding: '0.6rem 0.5rem', fontVariantNumeric: 'tabular-nums' }}>{link.clickCount ?? 0}</td>
              <td style={{ textAlign: 'center', padding: '0.6rem 0.5rem' }}>
                <span
                  style={{
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: link.active ? '#198754' : '#dc3545',
                    background: link.active ? '#d1e7dd' : '#f8d7da',
                  }}
                >
                  {link.active ? 'Ativo' : 'Inativo'}
                </span>
              </td>
              <td style={{ textAlign: 'center', padding: '0.6rem 0.5rem' }}>
                <button onClick={() => onSelect(link.slug)} style={{ marginRight: '0.5rem', padding: '0.3rem 0.6rem', border: '1px solid #ced4da', borderRadius: '4px', background: 'white', cursor: 'pointer' }}>
                  Stats
                </button>
                {link.active ? (
                  <button onClick={() => handleDeactivate(link.slug)} style={{ padding: '0.3rem 0.6rem', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    Desativar
                  </button>
                ) : (
                  <button onClick={() => handleReactivate(link.slug)} style={{ padding: '0.3rem 0.6rem', background: '#198754', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    Reativar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem', marginTop: '1rem' }}>
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            style={{ display: 'flex', alignItems: 'center', padding: '0.4rem 0.9rem', border: '1px solid #ced4da', borderRadius: '4px', background: 'white', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}
          >
            <ChevronLeft size={16} />
            Anterior
          </button>
          <span style={{ padding: '0 0.5rem', color: '#495057' }}>
            Página {page} de {totalPages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            style={{ display: 'flex', alignItems: 'center', padding: '0.4rem 0.9rem', border: '1px solid #ced4da', borderRadius: '4px', background: 'white', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}
          >
            Próxima
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
