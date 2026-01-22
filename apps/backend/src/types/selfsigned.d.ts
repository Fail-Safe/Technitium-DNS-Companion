declare module "selfsigned" {
  type Attribute = { name: string; value: string };

  type SubjectAltName =
    | { type: 2; value: string } // DNS
    | { type: 7; ip: string }; // IP

  interface GenerateOptions {
    algorithm?: string;
    days?: number;
    keySize?: number;
    extensions?: Array<
      | { name: "subjectAltName"; altNames: SubjectAltName[] }
      | Record<string, unknown>
    >;
  }

  interface GeneratedPems {
    private: string;
    public: string;
    cert: string;
    fingerprint: string;
  }

  const selfsigned: {
    generate: (attrs: Attribute[], opts?: GenerateOptions) => GeneratedPems;
  };

  export default selfsigned;
}
