export default function NoAccess() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="text-center max-w-md">
        <div className="mb-6">
          <div className="inline-block p-4 bg-red-100 rounded-full mb-4">
            <svg className="w-12 h-12 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
        </div>
        
        <h1 className="text-3xl font-bold text-gray-900 mb-4">No Active Access</h1>
        <p className="text-gray-600 mb-8">
          This email address hasn&apos;t been given access to this installation of the
          Research Automation Engine yet. Ask the person who runs it to add your email
          (Admin &rarr; User Management), or, if you set this up yourself, run
          <code className="mx-1 px-1 bg-gray-100 rounded">supabase/add-user.sql</code>
          with your email in the Supabase SQL Editor.
        </p>

        <div className="mt-8 pt-8 border-t border-gray-200">
          <p className="text-sm text-gray-500">
            Already added?{' '}
            <a href="/" className="text-blue-600 hover:text-blue-700 font-medium">
              Try logging in again
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

