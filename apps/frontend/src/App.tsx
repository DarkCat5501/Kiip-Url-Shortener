import { useState, useEffect, useCallback } from 'react';
import { CreateLink } from './components/CreateLink';
import { LinkList } from './components/LinkList';
import { LinkStats } from './components/LinkStats';

function App() {
  const [currentSlug, setCurrentSlug] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const getSlugFromHash = useCallback(() => {
    const hash = window.location.hash.slice(1);
    const match = hash.match(/^\/stats\/(.+)$/);
    return match ? match[1] : null;
  }, []);

  useEffect(() => {
    setCurrentSlug(getSlugFromHash());

    const handleHashChange = () => {
      setCurrentSlug(getSlugFromHash());
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [getSlugFromHash]);

  const handleCreated = () => {
    setReloadToken((t) => t + 1);
  };

  const navigateToStats = (slug: string) => {
    window.location.hash = `#/stats/${slug}`;
  };

  if (currentSlug) {
    return (
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif', color: '#212529' }}>
        <LinkStats slug={currentSlug} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem', fontFamily: 'system-ui, sans-serif', color: '#212529' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>KIIP — Encurtador de Links</h1>
      <CreateLink onCreated={handleCreated} />
      <LinkList onSelect={navigateToStats} reloadToken={reloadToken} />
    </div>
  );
}

export default App;