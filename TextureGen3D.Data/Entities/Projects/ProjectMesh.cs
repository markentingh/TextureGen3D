namespace TextureGen3D.Data.Entities.Projects
{
    public class ProjectMesh
    {
        public Guid Id { get; set; }
        public Guid ProjectId { get; set; }
        public Guid ModelId { get; set; }
        public string Name { get; set; } = "";
        public string MeshData { get; set; } = "";
        public string UVMapData { get; set; } = "";
        public int Triangles { get; set; }
        public int Vertices { get; set; }
        public string Prompt { get; set; } = "";
        public DateTime Created { get; set; }
    }
}
