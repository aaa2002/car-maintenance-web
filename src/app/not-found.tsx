import Link from 'next/link';

export default function NotFound() {
  return <main className="container min-vh-100 d-flex flex-column align-items-center justify-content-center text-center"><i className="bi bi-compass fs-1 text-body-secondary" /><h1 className="h3 mt-3">Page not found</h1><Link href="/" className="btn btn-primary mt-2">Back to garage</Link></main>;
}
