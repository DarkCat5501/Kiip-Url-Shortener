import { useState, useEffect } from 'react';
import { getLinkStats, type LinkStats as LinkStatsType } from '../lib/api';

interface Props {
  slug: string;
}

export function LinkStats({ slug }: Props) {
  const [stats, setStats] = useState<LinkStatsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    getLinkStats(slug)
      .then(setStats)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  if (loading) return <p>Carregando...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;
  if (!stats) return null;

  return (
    <div>
      <h2>Estatísticas: {slug}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
        <div style={{ padding: '1rem', background: '#f8f9fa', borderRadius: '8px' }}>
          <strong>URL:</strong> <a href={stats.url} target="_blank" rel="noopener noreferrer">{stats.url}</a>
        </div>
        <div style={{ padding: '1rem', background: '#f8f9fa', borderRadius: '8px' }}>
          <strong>Total de Cliques:</strong> {stats.totalClicks}
        </div>
      </div>

      <h3>Últimos 7 dias</h3>
      {stats.dailyStats.length === 0 ? (
        <p>Sem acessos nos últimos 7 dias.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '1rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ccc' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Data</th>
              <th style={{ textAlign: 'right', padding: '0.5rem' }}>Acessos</th>
            </tr>
          </thead>
          <tbody>
            {stats.dailyStats.map((day) => (
              <tr key={day.date} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.5rem' }}>{new Date(day.date).toLocaleDateString('pt-BR')}</td>
                <td style={{ textAlign: 'right', padding: '0.5rem' }}>{day.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Últimos 20 acessos</h3>
      {stats.recentAccesses.length === 0 ? (
        <p>Sem acessos registrados.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ccc' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Data/Hora</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Referer</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>User Agent</th>
            </tr>
          </thead>
          <tbody>
            {stats.recentAccesses.map((access, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{new Date(access.accessedAt).toLocaleString('pt-BR')}</td>
                <td style={{ padding: '0.5rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{access.referer || '-'}</td>
                <td style={{ padding: '0.5rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{access.userAgent || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}