import type { Link } from '../lib/api';
import { deactivateLink } from '../lib/api';
import { useState } from 'react';

interface Props {
  links: Link[];
  onSelect: (slug: string) => void;
  onDeactivated: (slug: string) => void;
}

const PAGE_SIZE = 10;

export function LinkList({ links, onSelect, onDeactivated }: Props) {
  const [page, setPage] = useState(1);
  const totalPages = Math.ceil(links.length / PAGE_SIZE);
  const paginatedLinks = links.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleDeactivate = async (slug: string) => {
    if (!confirm('Desativar este link?')) return;
    try {
      await deactivateLink(slug);
      onDeactivated(slug);
    } catch (err) {
      alert('Erro ao desativar link');
    }
  };

  if (links.length === 0) {
    return <p>Nenhum link criado ainda.</p>;
  }

  return (
    <div>
      <h2>Links ({links.length})</h2>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #ccc' }}>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>Slug</th>
            <th style={{ textAlign: 'left', padding: '0.5rem' }}>URL</th>
            <th style={{ textAlign: 'right', padding: '0.5rem' }}>Cliques</th>
            <th style={{ textAlign: 'center', padding: '0.5rem' }}>Status</th>
            <th style={{ textAlign: 'center', padding: '0.5rem' }}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {paginatedLinks.map((link) => (
            <tr key={link.id} style={{ borderBottom: '1px solid #eee' }}>
              <td style={{ padding: '0.5rem' }}>
                <a href={`/${link.slug}`} target="_blank" rel="noopener noreferrer">
                  {link.slug}
                </a>
              </td>
              <td style={{ padding: '0.5rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {link.url}
              </td>
              <td style={{ textAlign: 'right', padding: '0.5rem' }}>{link.clickCount ?? 0}</td>
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>
                <span style={{ color: link.active ? 'green' : 'red' }}>
                  {link.active ? 'Ativo' : 'Inativo'}
                </span>
              </td>
              <td style={{ textAlign: 'center', padding: '0.5rem' }}>
                <button onClick={() => onSelect(link.slug)} style={{ marginRight: '0.5rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}>
                  Stats
                </button>
                {link.active && (
                  <button onClick={() => handleDeactivate(link.slug)} style={{ padding: '0.25rem 0.5rem', background: '#dc3545', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                    Desativar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', marginTop: '1rem' }}>
          <button 
            onClick={() => setPage(p => Math.max(1, p - 1))} 
            disabled={page === 1}
            style={{ padding: '0.5rem 1rem', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}
          >
            ← Anterior
          </button>
          <span style={{ padding: '0.5rem 1rem', lineHeight: '2rem' }}>
            Página {page} de {totalPages}
          </span>
          <button 
            onClick={() => setPage(p => Math.min(totalPages, p + 1))} 
            disabled={page === totalPages}
            style={{ padding: '0.5rem 1rem', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}
          >
            Próxima →
          </button>
        </div>
      )}
    </div>
  );
}