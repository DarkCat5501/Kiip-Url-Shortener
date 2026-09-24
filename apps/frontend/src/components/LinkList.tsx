import type { Link } from '../lib/api';
import { deactivateLink } from '../lib/api';

interface Props {
  links: Link[];
  onSelect: (slug: string) => void;
  onDeactivated: (slug: string) => void;
}

export function LinkList({ links, onSelect, onDeactivated }: Props) {
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
      <h2>Links</h2>
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
          {links.map((link) => (
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
    </div>
  );
}