import { useState, useEffect } from 'react';
import { CreateLink } from './components/CreateLink';
import { LinkList } from './components/LinkList';
import { LinkStats } from './components/LinkStats';
import { getLinks, type Link } from './lib/api';

function App() {
  const [links, setLinks] = useState<Link[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLinks();
  }, []);

  const loadLinks = async () => {
    try {
      const data = await getLinks();
      setLinks(data);
    } catch (err) {
      console.error('Failed to load links:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreated = (link: Link) => {
    setLinks((prev) => [link, ...prev]);
  };

  const handleDeactivated = (slug: string) => {
    setLinks((prev) =>
      prev.map((l) => (l.slug === slug ? { ...l, active: false } : l))
    );
  };

  if (selectedSlug) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
        <LinkStats slug={selectedSlug} onBack={() => setSelectedSlug(null)} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
      <h1>KIIP - Encurtador de Links</h1>
      <CreateLink onCreated={handleCreated} />
      {loading ? <p>Carregando links...</p> : <LinkList links={links} onSelect={setSelectedSlug} onDeactivated={handleDeactivated} />}
    </div>
  );
}

export default App;