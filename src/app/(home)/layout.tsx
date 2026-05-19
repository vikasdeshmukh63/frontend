import Navbar from '@/modules/home/ui/components/navbar';
import { HomeArcBackground } from '@/modules/home/ui/components/home-arc-background';

interface Props {
  children: React.ReactNode;
}

const Layout = ({ children }: Props) => {
  return (
    <main className="relative flex max-h-screen min-h-screen flex-col">
      <HomeArcBackground />
      <Navbar />
      <div className="relative z-10 flex flex-1 flex-col px-4 pb-4">
        {children}
      </div>
    </main>
  );
};

export default Layout;
