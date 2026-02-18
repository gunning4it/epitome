interface ToolParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

interface ToolBlockProps {
  name: string;
  description: string;
  params?: ToolParam[];
  children?: React.ReactNode;
}

export function ToolBlock({ name, description, params, children }: ToolBlockProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 my-4">
      <h4 className="text-base font-semibold font-mono text-foreground mb-2">
        {name}
      </h4>
      <p className="text-sm text-muted-foreground mb-0">{description}</p>

      {params && params.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="pb-2 pr-4 font-medium text-foreground">Name</th>
                <th className="pb-2 pr-4 font-medium text-foreground">Type</th>
                <th className="pb-2 pr-4 font-medium text-foreground">Required</th>
                <th className="pb-2 font-medium text-foreground">Description</th>
              </tr>
            </thead>
            <tbody>
              {params.map((param) => (
                <tr key={param.name} className="border-b border-border/50">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground">
                    {param.name}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">
                    {param.type}
                  </td>
                  <td className="py-2 pr-4">
                    {param.required ? (
                      <span className="text-xs text-green-400">Yes</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {param.description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}
