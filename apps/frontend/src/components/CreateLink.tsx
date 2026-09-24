import { useState } from 'react';
import { createLink, type Link } from '../lib/api';

interface Props {
  onCreated: (link: Link) => void;
}

export function CreateLink({ onCreated }: Props) {
  const [url, setUrl] = useState('');
  const [slug, setSlug] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [maxClicks, setMaxClicks] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const link = await createLink({
        url,
        slug: slug || undefined,
        expiresAt: expiresAt || undefined,
        maxClicks: maxClicks ? parseInt(maxClicks) : undefined,
      });
      onCreated(link);
      setUrl('');
      setSlug('');
      setExpiresAt('');
      setMaxClicks('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { padding: '0.6rem 0.75rem', border: '1px solid #ced4da', borderRadius: '6px', fontSize: '0.9rem' };

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: '2rem', padding: '1.25rem', border: '1px solid #dee2e6', borderRadius: '8px', background: '#fff' }}>
      <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>Criar Link</h2>
      {error && <p style={{ color: '#dc3545', background: '#f8d7da', padding: '0.5rem 0.75rem', borderRadius: '6px' }}>{error}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <input
          type="url"
          placeholder="URL (obrigatório)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          style={inputStyle}
        />
        <input
          type="text"
          placeholder="Slug customizado (opcional)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          maxLength={10}
          style={inputStyle}
        />
        <input
          type="datetime-local"
          placeholder="Data de expiração (opcional)"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          style={inputStyle}
        />
        <input
          type="number"
          placeholder="Máximo de cliques (opcional)"
          value={maxClicks}
          onChange={(e) => setMaxClicks(e.target.value)}
          min="1"
          style={inputStyle}
        />
        <button type="submit" disabled={loading} style={{ padding: '0.6rem', background: '#007bff', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
          {loading ? 'Criando...' : 'Criar Link'}
        </button>
      </div>
    </form>
  );
}