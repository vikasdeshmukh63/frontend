import { Build01Logo } from '@/components/build01-logo';
import { ProjectForm } from '@/modules/home/ui/components/project-form';
import { ProjectsList } from '@/modules/home/ui/components/projects-list';

const Page = () => {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col">
      <section className="space-y-6 py-[16vh] 2xl:py-48">
        <div className="flex items-center justify-center">
          <Build01Logo
            height={52}
            variant="wordmark"
            className="text-white"
            cutStroke="on-emphasis"
          />
        </div>
        <h1 className="text-center text-2xl font-bold text-white md:text-5xl">
          Build something with Build01
        </h1>
        <p className="text-center text-lg text-white/75 md:text-xl">
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
