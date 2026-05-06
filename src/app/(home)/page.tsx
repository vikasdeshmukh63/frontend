import { ProjectForm } from '@/modules/home/ui/components/project-form';
import { ProjectsList } from '@/modules/home/ui/components/projects-list';
import Image from 'next/image';

const Page = () => {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <section className="space-y-6 py-[16vh] 2xl:py-48">
        <div className="flex items-center justify-center gap-2">
          <Image
            src="/logo.svg"
            alt="Fingerchip"
            width={80}
            height={80}
            className="hidden md:block"
          />
          <span className="text-4xl font-bold">Fingerchip</span>
        </div>
        <h1 className="text-center text-2xl font-bold md:text-5xl">
          Build Something with Fingerchip
        </h1>
        <p className="text-muted-foreground text-center text-lg md:text-xl">
          Create apps and websites by chatting with AI
        </p>
        <div className="mx-auto w-full max-w-3xl">
          <ProjectForm />
        </div>
      </section>
      <ProjectsList />
    </div>
  );
};

export default Page;
