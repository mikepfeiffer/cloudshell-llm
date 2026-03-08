import { useAuth } from '../hooks/useAuth';

export function LoginButton() {
  const { login } = useAuth();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900">
      <div className="text-center space-y-6 max-w-md px-6">
        <h1 className="text-4xl font-bold text-white">CloudShell LLM</h1>
        <p className="text-slate-400">
          Natural language interface to Azure Cloud Shell. Type what you want to do — we'll
          generate the command and run it in your Azure environment.
        </p>
        <button
          onClick={login}
          className="w-full py-3 px-6 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg transition-colors"
        >
          Sign in with Microsoft
        </button>
        <p className="text-slate-500 text-xs">
          Your Azure RBAC permissions apply — you can only do what you're already authorized to do.
        </p>
      </div>
    </div>
  );
}
